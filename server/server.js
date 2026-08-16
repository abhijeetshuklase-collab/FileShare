"use strict";

const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const os = require("os");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();

const PORT =
    process.env.PORT || 3000;


// =====================================================
// BACKBLAZE CONFIGURATION
// =====================================================

const REGION =
    process.env.B2_REGION;

const ENDPOINT =
    process.env.B2_ENDPOINT;

const KEY_ID =
    process.env.B2_KEY_ID;

const APPLICATION_KEY =
    process.env.B2_APPLICATION_KEY;

const BUCKET_NAME =
    process.env.B2_BUCKET_NAME;


// =====================================================
// CLOUDFLARE WORKER DOWNLOAD URL
// =====================================================
//
// IMPORTANT:
// Do NOT add a trailing slash.
//
// Working Worker:
// https://young-queen-e763.workers.dev
//
// =====================================================

const CLOUDFLARE_DOWNLOAD_DOMAIN =
    (
        process.env.CLOUDFLARE_DOWNLOAD_DOMAIN ||
        "https://young-queen-e763.workers.dev"
    ).replace(/\/+$/, "");


// =====================================================
// CHECK CONFIGURATION
// =====================================================

if (
    !REGION ||
    !ENDPOINT ||
    !KEY_ID ||
    !APPLICATION_KEY ||
    !BUCKET_NAME
) {

    console.error("");
    console.error("========================================");
    console.error("MISSING BACKBLAZE CONFIGURATION");
    console.error("========================================");
    console.error("");
    console.error("Required:");
    console.error("B2_REGION");
    console.error("B2_ENDPOINT");
    console.error("B2_KEY_ID");
    console.error("B2_APPLICATION_KEY");
    console.error("B2_BUCKET_NAME");
    console.error("");

    process.exit(1);
}


// =====================================================
// BACKBLAZE S3 CLIENT
// =====================================================

const s3 =
    new S3Client({

        region:
            REGION,

        endpoint:
            ENDPOINT,

        credentials: {

            accessKeyId:
                KEY_ID,

            secretAccessKey:
                APPLICATION_KEY
        },

        forcePathStyle:
            true,

        maxAttempts:
            5,

        requestChecksumCalculation:
            "WHEN_REQUIRED",

        responseChecksumValidation:
            "WHEN_REQUIRED"
    });


// =====================================================
// FRONTEND
// =====================================================

const frontendPath =
    path.resolve(
        __dirname,
        ".."
    );


app.use(
    express.static(
        frontendPath
    )
);


// =====================================================
// HOME
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                frontendPath,
                "index.html"
            )
        );
    }
);


// =====================================================
// HEALTH
// =====================================================

app.get(
    "/health",
    (req, res) => {

        res.json({

            status:
                "OK",

            server:
                "FileShare",

            backblaze:
                "configured",

            cloudflare:
                "configured"
        });
    }
);


// =====================================================
// AUTO DELETE SETTINGS
// =====================================================

const DELETE_TIMES = {

    "600":
        10 * 60,

    "1800":
        30 * 60,

    "3600":
        60 * 60
};


// =====================================================
// TEMPORARY UPLOAD DIRECTORY
// =====================================================

const tempDirectory =
    path.join(
        os.tmpdir(),
        "fileshare-uploads"
    );


if (
    !fs.existsSync(
        tempDirectory
    )
) {

    fs.mkdirSync(
        tempDirectory,
        {
            recursive:
                true
        }
    );
}


// =====================================================
// MULTER
// =====================================================

const storage =
    multer.diskStorage({

        destination:
            (req, file, cb) => {

                cb(
                    null,
                    tempDirectory
                );
            },

        filename:
            (req, file, cb) => {

                const uniqueName =
                    `${Date.now()}-${Math.random()
                        .toString(36)
                        .substring(2, 14)}`;

                cb(
                    null,
                    uniqueName
                );
            }
    });


const upload =
    multer({

        storage:
            storage
    });


// =====================================================
// MULTIPART SETTINGS
// =====================================================

// 10 MB per part

const PART_SIZE =
    10 *
    1024 *
    1024;


// 10 parts simultaneously
// Keeps Render memory/network usage reasonable.

const CONCURRENT_PARTS =
    10;


// =====================================================
// SAFE FILE NAME
// =====================================================

function safeFileName(
    originalName
) {

    return path
        .basename(
            originalName
        )
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        );
}


// =====================================================
// UPLOAD ONE PART
// =====================================================

async function uploadSinglePart(
    filePath,
    fileSize,
    key,
    uploadId,
    partNumber
) {

    const start =
        (
            partNumber -
            1
        ) *
        PART_SIZE;


    const end =
        Math.min(
            start +
            PART_SIZE,
            fileSize
        );


    const contentLength =
        end -
        start;


    const stream =
        fs.createReadStream(
            filePath,
            {

                start:
                    start,

                end:
                    end -
                    1
            }
        );


    try {

        const result =
            await s3.send(
                new UploadPartCommand({

                    Bucket:
                        BUCKET_NAME,

                    Key:
                        key,

                    UploadId:
                        uploadId,

                    PartNumber:
                        partNumber,

                    Body:
                        stream,

                    ContentLength:
                        contentLength
                })
            );


        if (
            !result.ETag
        ) {

            throw new Error(
                `Part ${partNumber} did not return ETag.`
            );
        }


        console.log(
            `Part ${partNumber} uploaded.`
        );


        return {

            PartNumber:
                partNumber,

            ETag:
                result.ETag
        };


    } catch (error) {

        stream.destroy();

        throw error;
    }
}


// =====================================================
// MULTIPART UPLOAD
// =====================================================

async function uploadLargeFile(
    filePath,
    key,
    contentType,
    metadata
) {

    let uploadId =
        null;


    try {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "STARTING MULTIPART UPLOAD"
        );
        console.log(
            "========================================"
        );


        // -------------------------------------------------
        // CREATE MULTIPART UPLOAD
        // -------------------------------------------------

        const createResult =
            await s3.send(
                new CreateMultipartUploadCommand({

                    Bucket:
                        BUCKET_NAME,

                    Key:
                        key,

                    ContentType:
                        contentType,

                    Metadata:
                        metadata
                })
            );


        uploadId =
            createResult.UploadId;


        if (
            !uploadId
        ) {

            throw new Error(
                "Backblaze did not return UploadId."
            );
        }


        // -------------------------------------------------
        // FILE SIZE
        // -------------------------------------------------

        const stats =
            await fs.promises.stat(
                filePath
            );


        const fileSize =
            stats.size;


        const totalParts =
            Math.ceil(
                fileSize /
                PART_SIZE
            );


        console.log(
            "File size:",
            fileSize
        );


        console.log(
            "Total parts:",
            totalParts
        );


        console.log(
            "Concurrent parts:",
            CONCURRENT_PARTS
        );


        // -------------------------------------------------
        // UPLOAD PARTS
        // -------------------------------------------------

        const completedParts =
            [];


        for (
            let batchStart = 1;

            batchStart <=
                totalParts;

            batchStart +=
                CONCURRENT_PARTS
        ) {

            const batchEnd =
                Math.min(

                    batchStart +
                    CONCURRENT_PARTS -
                    1,

                    totalParts
                );


            console.log(
                `Uploading parts ${batchStart}-${batchEnd}/${totalParts}`
            );


            const promises =
                [];


            for (
                let partNumber =
                    batchStart;

                partNumber <=
                    batchEnd;

                partNumber++
            ) {

                promises.push(

                    uploadSinglePart(

                        filePath,

                        fileSize,

                        key,

                        uploadId,

                        partNumber
                    )
                );
            }


            const results =
                await Promise.all(
                    promises
                );


            completedParts.push(
                ...results
            );
        }


        // -------------------------------------------------
        // SORT PARTS
        // -------------------------------------------------

        completedParts.sort(
            (a, b) =>
                a.PartNumber -
                b.PartNumber
        );


        // -------------------------------------------------
        // COMPLETE
        // -------------------------------------------------

        await s3.send(
            new CompleteMultipartUploadCommand({

                Bucket:
                    BUCKET_NAME,

                Key:
                    key,

                UploadId:
                    uploadId,

                MultipartUpload: {

                    Parts:
                        completedParts
                }
            })
        );


        console.log(
            "Multipart upload completed successfully."
        );


    } catch (error) {

        // -------------------------------------------------
        // ABORT FAILED UPLOAD
        // -------------------------------------------------

        if (
            uploadId
        ) {

            try {

                await s3.send(
                    new AbortMultipartUploadCommand({

                        Bucket:
                            BUCKET_NAME,

                        Key:
                            key,

                        UploadId:
                            uploadId
                    })
                );


                console.log(
                    "Failed multipart upload aborted."
                );


            } catch (abortError) {

                console.error(
                    "Abort error:",
                    abortError.message
                );
            }
        }


        throw error;
    }
}


// =====================================================
// AUTO DELETE CLEANUP
// =====================================================

async function cleanupExpiredFiles() {

    try {

        let token =
            undefined;


        do {

            const result =
                await s3.send(
                    new ListObjectsV2Command({

                        Bucket:
                            BUCKET_NAME,

                        ContinuationToken:
                            token
                    })
                );


            const objects =
                result.Contents ||
                [];


            for (
                const object
                of objects
            ) {

                if (
                    !object.Key
                ) {

                    continue;
                }


                try {

                    const head =
                        await s3.send(
                            new HeadObjectCommand({

                                Bucket:
                                    BUCKET_NAME,

                                Key:
                                    object.Key
                            })
                        );


                    const metadata =
                        head.Metadata ||
                        {};


                    if (
                        !metadata.deleteat
                    ) {

                        continue;
                    }


                    const deleteTime =
                        Number(
                            metadata.deleteat
                        );


                    if (
                        Number.isFinite(
                            deleteTime
                        ) &&
                        Date.now() >=
                            deleteTime
                    ) {

                        console.log(
                            "Auto deleting:",
                            object.Key
                        );


                        await s3.send(
                            new DeleteObjectCommand({

                                Bucket:
                                    BUCKET_NAME,

                                Key:
                                    object.Key
                            })
                        );


                        console.log(
                            "Auto delete successful:",
                            object.Key
                        );
                    }


                } catch (error) {

                    console.error(
                        "Checking file failed:",
                        object.Key,
                        error.message
                    );
                }
            }


            token =
                result.IsTruncated
                    ? result.NextContinuationToken
                    : undefined;


        } while (
            token
        );


    } catch (error) {

        console.error(
            "Cleanup failed:",
            error.message
        );
    }
}


// =====================================================
// CLEANUP TIMER
// =====================================================

setInterval(
    cleanupExpiredFiles,
    60 *
    1000
);


setTimeout(
    cleanupExpiredFiles,
    5000
);


// =====================================================
// UPLOAD ROUTE
// =====================================================

app.post(
    "/upload",

    upload.single("file"),

    async (req, res) => {

        let temporaryFilePath =
            null;


        try {

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "UPLOAD REQUEST"
            );
            console.log(
                "========================================"
            );


            // -------------------------------------------------
            // CHECK FILE
            // -------------------------------------------------

            if (
                !req.file
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "No file received."
                    });
            }


            temporaryFilePath =
                req.file.path;


            // -------------------------------------------------
            // DELETE OPTION
            // -------------------------------------------------

            const deleteAfter =
                String(
                    req.body.deleteAfter ||
                    ""
                );


            const isAfterDownload =
                deleteAfter ===
                "download";


            const isTimed =
                Object.prototype
                    .hasOwnProperty.call(
                        DELETE_TIMES,
                        deleteAfter
                    );


            if (
                !isAfterDownload &&
                !isTimed
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid Auto Delete option."
                    });
            }


            // -------------------------------------------------
            // FILE NAME
            // -------------------------------------------------

            const fileName =
                safeFileName(
                    req.file.originalname
                );


            const key =
                `${Date.now()}-${fileName}`;


            // -------------------------------------------------
            // METADATA
            // -------------------------------------------------

            const metadata =
                {};


            let deleteAt;


            if (
                isAfterDownload
            ) {

                // The Worker handles the actual download,
                // so Render cannot reliably detect completion.
                //
                // Therefore this option means:
                // delete after maximum 30 minutes.

                deleteAt =
                    Date.now() +
                    (
                        30 *
                        60 *
                        1000
                    );


                metadata.deletemode =
                    "after-download";


            } else {

                deleteAt =
                    Date.now() +
                    (
                        DELETE_TIMES[
                            deleteAfter
                        ] *
                        1000
                    );


                metadata.deletemode =
                    "timed";
            }


            metadata.deleteat =
                String(
                    deleteAt
                );


            // -------------------------------------------------
            // LOG
            // -------------------------------------------------

            console.log(
                "File:",
                fileName
            );


            console.log(
                "Size:",
                req.file.size
            );


            console.log(
                "Delete mode:",
                metadata.deletemode
            );


            console.log(
                "Delete at:",
                new Date(
                    deleteAt
                ).toISOString()
            );


            // -------------------------------------------------
            // UPLOAD TO BACKBLAZE
            // -------------------------------------------------

            await uploadLargeFile(

                temporaryFilePath,

                key,

                req.file.mimetype ||
                    "application/octet-stream",

                metadata
            );


            // -------------------------------------------------
            // CLOUDFLARE WORKER DOWNLOAD URL
            // -------------------------------------------------
            //
            // IMPORTANT:
            // This is now the actual download URL.
            //
            // Render does NOT stream the file.
            //
            // Flow:
            //
            // User
            //   ↓
            // Cloudflare Worker
            //   ↓
            // Private Backblaze
            //
            // -------------------------------------------------

            const encodedKey =
                encodeURIComponent(
                    key
                );


            const downloadUrl =
                `${CLOUDFLARE_DOWNLOAD_DOMAIN}/file/${encodedKey}`;


            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "UPLOAD SUCCESSFUL"
            );
            console.log(
                "========================================"
            );


            console.log(
                "Key:",
                key
            );


            console.log(
                "Cloudflare Download URL:",
                downloadUrl
            );


            // -------------------------------------------------
            // RESPONSE
            // -------------------------------------------------

            return res
                .status(200)
                .json({

                    success:
                        true,

                    message:
                        "File uploaded successfully.",

                    fileName:
                        fileName,

                    key:
                        key,

                    downloadUrl:
                        downloadUrl,

                    deleteMode:
                        isAfterDownload
                            ? "after-download"
                            : "timed",

                    deleteAt:
                        new Date(
                            deleteAt
                        ).toISOString()
                });


        } catch (error) {

            console.error("");
            console.error(
                "========================================"
            );
            console.error(
                "UPLOAD ERROR"
            );
            console.error(
                "========================================"
            );


            console.error(
                "Name:",
                error.name
            );


            console.error(
                "Message:",
                error.message
            );


            console.error(
                "Code:",
                error.Code ||
                error.code ||
                "N/A"
            );


            console.error(
                "HTTP:",
                error.$metadata?.httpStatusCode ||
                "N/A"
            );


            if (
                !res.headersSent
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "Upload failed.",

                        details:
                            error.message
                    });
            }


        } finally {

            // -------------------------------------------------
            // DELETE TEMPORARY FILE
            // -------------------------------------------------

            if (
                temporaryFilePath
            ) {

                try {

                    await fs.promises.unlink(
                        temporaryFilePath
                    );


                } catch (error) {

                    console.error(
                        "Temporary file cleanup:",
                        error.message
                    );
                }
            }
        }
    }
);


// =====================================================
// OLD DOWNLOAD ROUTE
// =====================================================
//
// Kept as a compatibility fallback.
//
// IMPORTANT:
// New upload responses DO NOT use this route.
//
// New downloads go directly to Cloudflare Worker.
//
// =====================================================

app.get(
    "/download/:key",

    async (req, res) => {

        const key =
            req.params.key;


        if (
            !key
        ) {

            return res
                .status(400)
                .send(
                    "Invalid download link."
                );
        }


        // Redirect old links to Cloudflare Worker.

        const downloadUrl =
            `${CLOUDFLARE_DOWNLOAD_DOMAIN}/file/${encodeURIComponent(
                key
            )}`;


        console.log(
            "Redirecting old download URL to Cloudflare:",
            downloadUrl
        );


        return res.redirect(
            302,
            downloadUrl
        );
    }
);


// =====================================================
// MULTER ERROR HANDLER
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        if (
            error instanceof
            multer.MulterError
        ) {

            console.error(
                "MULTER ERROR:",
                error.message
            );


            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Upload error.",

                    details:
                        error.message
                });
        }


        next(
            error
        );
    }
);


// =====================================================
// GENERAL ERROR HANDLER
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "SERVER ERROR:",
            error
        );


        if (
            !res.headersSent
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Server error.",

                    details:
                        error.message
                });
        }


        next(
            error
        );
    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "FILESHARE SERVER RUNNING"
        );
        console.log(
            "========================================"
        );


        console.log(
            `Port: ${PORT}`
        );


        console.log(
            "Multipart:",
            "10 MB parts / 10 concurrent"
        );


        console.log(
            "Backblaze:",
            "PRIVATE BUCKET"
        );


        console.log(
            "Cloudflare Downloads:",
            CLOUDFLARE_DOWNLOAD_DOMAIN
        );


        console.log(
            "Auto Delete:",
            "ENABLED"
        );


        console.log(
            "========================================"
        );
    }
);