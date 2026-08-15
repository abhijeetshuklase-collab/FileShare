"use strict";

const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pipeline } = require("stream");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;


// =====================================================
// BACKBLAZE B2 CONFIGURATION
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
// CHECK BACKBLAZE CONFIGURATION
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
    console.error("Required environment variables:");
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
// PROJECT PATHS
// =====================================================
//
// FileShare/
// ├── index.html
// ├── app.js
// ├── style.css
// ├── GooglePay_QR.png
// └── server/
//     └── app.js
//
// =====================================================

const projectDirectory =
    path.resolve(
        __dirname,
        ".."
    );


// =====================================================
// TEMPORARY UPLOAD DIRECTORY
// =====================================================

const temporaryDirectory =
    path.join(
        os.tmpdir(),
        "fileshare-uploads"
    );

if (
    !fs.existsSync(
        temporaryDirectory
    )
) {

    fs.mkdirSync(
        temporaryDirectory,
        {
            recursive: true
        }
    );
}


// =====================================================
// MULTER DISK STORAGE
// =====================================================

const storage =
    multer.diskStorage({

        destination:
            (req, file, callback) => {

                callback(
                    null,
                    temporaryDirectory
                );
            },

        filename:
            (req, file, callback) => {

                const uniqueName =
                    `${Date.now()}-${Math.random()
                        .toString(36)
                        .substring(2, 14)}`;

                callback(
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
// FRONTEND STATIC FILES
// =====================================================

app.use(
    express.static(
        projectDirectory
    )
);


// =====================================================
// EXPLICIT QR CODE ROUTE
// =====================================================

app.get(
    "/GooglePay_QR.png",
    (req, res) => {

        const qrPath =
            path.join(
                projectDirectory,
                "GooglePay_QR.png"
            );

        console.log(
            "QR request:",
            qrPath
        );

        if (
            !fs.existsSync(
                qrPath
            )
        ) {

            console.error(
                "QR file not found:",
                qrPath
            );

            return res
                .status(404)
                .send(
                    "GooglePay_QR.png not found."
                );
        }

        res.sendFile(
            qrPath
        );
    }
);


// =====================================================
// HOME PAGE
// =====================================================

app.get(
    "/",
    (req, res) => {

        const indexPath =
            path.join(
                projectDirectory,
                "index.html"
            );

        if (
            !fs.existsSync(
                indexPath
            )
        ) {

            return res
                .status(500)
                .send(
                    "index.html not found."
                );
        }

        res.sendFile(
            indexPath
        );
    }
);


// =====================================================
// HEALTH CHECK
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
// MULTIPART SETTINGS
// =====================================================

// 10 MB per part
const PART_SIZE =
    10 *
    1024 *
    1024;


// 20 parts simultaneously
const CONCURRENT_PARTS =
    20;


// =====================================================
// SAFE FILE NAME
// =====================================================

function createSafeFileName(
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

    console.log(
        `Starting part ${partNumber}`
    );

    const fileStream =
        fs.createReadStream(
            filePath,
            {
                start:
                    start,

                end:
                    end - 1
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
                        fileStream,

                    ContentLength:
                        contentLength

                })
            );

        if (
            !result.ETag
        ) {

            throw new Error(
                `Part ${partNumber} did not return an ETag.`
            );
        }

        console.log(
            `Part ${partNumber} uploaded successfully.`
        );

        return {

            PartNumber:
                partNumber,

            ETag:
                result.ETag

        };

    } catch (error) {

        fileStream.destroy();

        throw error;
    }
}


// =====================================================
// LARGE FILE MULTIPART UPLOAD
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
                "Backblaze did not return an UploadId."
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
            fileSize,
            "bytes"
        );

        console.log(
            "Part size:",
            PART_SIZE,
            "bytes"
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
        // UPLOAD IN BATCHES OF 20
        // -------------------------------------------------

        const completedParts =
            [];


        for (
            let batchStart = 1;

            batchStart <= totalParts;

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
                `Uploading parts ${batchStart}-${batchEnd} of ${totalParts}`
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


            console.log(
                `Parts ${batchStart}-${batchEnd} completed.`
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
        // COMPLETE MULTIPART UPLOAD
        // -------------------------------------------------

        console.log(
            "Completing multipart upload..."
        );


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
            "Multipart upload completed."
        );


        return true;


    } catch (error) {


        // -------------------------------------------------
        // ABORT FAILED MULTIPART UPLOAD
        // -------------------------------------------------

        if (
            uploadId
        ) {

            try {

                console.log(
                    "Aborting failed multipart upload..."
                );


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
                    "Multipart upload aborted."
                );


            } catch (
                abortError
            ) {

                console.error(
                    "Could not abort multipart upload:",
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

        let continuationToken =
            undefined;


        do {

            const result =
                await s3.send(
                    new ListObjectsV2Command({

                        Bucket:
                            BUCKET_NAME,

                        ContinuationToken:
                            continuationToken

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


                    const deleteAt =
                        metadata.deleteat;


                    if (
                        !deleteAt
                    ) {

                        continue;
                    }


                    const deleteTime =
                        Number(
                            deleteAt
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
                            "Auto delete complete:",
                            object.Key
                        );
                    }


                } catch (error) {

                    console.error(
                        "Auto-delete check failed:",
                        object.Key,
                        error.message
                    );
                }
            }


            continuationToken =
                result.IsTruncated
                    ? result.NextContinuationToken
                    : undefined;


        } while (
            continuationToken
        );


    } catch (error) {

        console.error(
            "Cleanup error:",
            error.message
        );
    }
}


// =====================================================
// START CLEANUP
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


        let temporaryFilePath =
            null;


        try {

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
            // AUTO DELETE OPTION
            // -------------------------------------------------

            const deleteAfter =
                String(
                    req.body.deleteAfter ||
                    ""
                );


            const isAfterDownload =
                deleteAfter ===
                "download";


            const isTimedDelete =
                Object.prototype
                    .hasOwnProperty.call(
                        DELETE_TIMES,
                        deleteAfter
                    );


            if (
                !isAfterDownload &&
                !isTimedDelete
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

            const cleanFileName =
                createSafeFileName(
                    req.file.originalname
                );


            const key =
                `${Date.now()}-${cleanFileName}`;


            // -------------------------------------------------
            // METADATA
            // -------------------------------------------------

            const metadata =
                {};


            let deleteAt;


            if (
                isAfterDownload
            ) {

                metadata.deletemode =
                    "after-download";


                // Maximum 30 minutes
                // if nobody downloads it.

                deleteAt =
                    Date.now() +
                    (
                        30 *
                        60 *
                        1000
                    );


                metadata.deleteat =
                    String(
                        deleteAt
                    );


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


                metadata.deleteat =
                    String(
                        deleteAt
                    );
            }


            // -------------------------------------------------
            // LOG
            // -------------------------------------------------

            console.log(
                "File:",
                cleanFileName
            );

            console.log(
                "Size:",
                req.file.size,
                "bytes"
            );

            console.log(
                "MIME:",
                req.file.mimetype
            );

            console.log(
                "Auto Delete:",
                isAfterDownload
                    ? "After Download (Max 30 Minutes)"
                    : new Date(
                        deleteAt
                    ).toLocaleString()
            );


            // -------------------------------------------------
            // MULTIPART UPLOAD
            // -------------------------------------------------

            await uploadLargeFile(

                temporaryFilePath,

                key,

                req.file.mimetype ||
                    "application/octet-stream",

                metadata

            );


            // -------------------------------------------------
            // DOWNLOAD URL
            // -------------------------------------------------

            const downloadUrl =
                `/download/${encodeURIComponent(
                    key
                )}`;


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
                "Download URL:",
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

                    fileName:
                        cleanFileName,

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
                error
            );


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


        } finally {

            // -------------------------------------------------
            // DELETE TEMP FILE
            // -------------------------------------------------

            if (
                temporaryFilePath
            ) {

                try {

                    await fs.promises.unlink(
                        temporaryFilePath
                    );


                    console.log(
                        "Temporary upload file removed."
                    );


                } catch (cleanupError) {

                    console.error(
                        "Temporary file cleanup failed:",
                        cleanupError.message
                    );
                }
            }
        }
    }
);


// =====================================================
// DOWNLOAD ROUTE
// =====================================================

app.get(
    "/download/:key",
    async (req, res) => {

        let key = null;

        let downloadCompleted =
            false;

        let afterDownloadDelete =
            false;


        try {

            // -------------------------------------------------
            // GET KEY
            // -------------------------------------------------

            key =
                req.params.key;


            if (
                !key ||
                typeof key !==
                    "string"
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid download link."
                    );
            }


            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "DOWNLOAD REQUEST"
            );
            console.log(
                "========================================"
            );

            console.log(
                "Requested key:",
                key
            );


            // -------------------------------------------------
            // CHECK OBJECT FIRST
            // -------------------------------------------------

            let headResult;


            try {

                headResult =
                    await s3.send(
                        new HeadObjectCommand({

                            Bucket:
                                BUCKET_NAME,

                            Key:
                                key

                        })
                    );


            } catch (headError) {

                console.error(
                    "Backblaze HeadObject failed:",
                    headError.message
                );


                if (
                    headError.name ===
                        "NotFound" ||
                    headError.name ===
                        "NoSuchKey" ||
                    headError.$metadata?.httpStatusCode ===
                        404
                ) {

                    return res
                        .status(404)
                        .send(
                            "File not found. It may have expired or already been deleted."
                        );
                }


                return res
                    .status(500)
                    .send(
                        "Unable to locate the file."
                    );
            }


            // -------------------------------------------------
            // CHECK AUTO DELETE METADATA
            // -------------------------------------------------

            const metadata =
                headResult.Metadata ||
                {};


            afterDownloadDelete =
                metadata.deletemode ===
                "after-download";


            // -------------------------------------------------
            // SAFETY CHECK FOR EXPIRED FILE
            // -------------------------------------------------

            if (
                metadata.deleteat
            ) {

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
                        "File has expired."
                    );


                    // Delete expired object.

                    try {

                        await s3.send(
                            new DeleteObjectCommand({

                                Bucket:
                                    BUCKET_NAME,

                                Key:
                                    key

                            })
                        );

                    } catch (
                        deleteError
                    ) {

                        console.error(
                            "Expired-file deletion failed:",
                            deleteError.message
                        );
                    }


                    return res
                        .status(410)
                        .send(
                            "This file has expired and is no longer available."
                        );
                }
            }


            // -------------------------------------------------
            // GET OBJECT
            // -------------------------------------------------

            let objectResult;


            try {

                objectResult =
                    await s3.send(
                        new GetObjectCommand({

                            Bucket:
                                BUCKET_NAME,

                            Key:
                                key

                        })
                    );


            } catch (getError) {

                console.error(
                    "Backblaze GetObject failed:",
                    getError
                );


                if (
                    getError.name ===
                        "NoSuchKey" ||
                    getError.name ===
                        "NotFound" ||
                    getError.$metadata?.httpStatusCode ===
                        404
                ) {

                    return res
                        .status(404)
                        .send(
                            "File not found. It may have expired or already been deleted."
                        );
                }


                return res
                    .status(500)
                    .send(
                        "Download failed because the storage service could not provide the file."
                    );
            }


            // -------------------------------------------------
            // CHECK BODY
            // -------------------------------------------------

            if (
                !objectResult.Body
            ) {

                console.error(
                    "Backblaze returned an empty response body."
                );


                return res
                    .status(500)
                    .send(
                        "Download failed because the file data was empty."
                    );
            }


            // -------------------------------------------------
            // ORIGINAL FILE NAME
            // -------------------------------------------------

            let originalFileName =
                path.basename(
                    key
                );


            // Remove timestamp prefix.

            originalFileName =
                originalFileName.replace(
                    /^\d+-/,
                    ""
                );


            // -------------------------------------------------
            // SAFER CONTENT DISPOSITION
            // -------------------------------------------------

            const encodedFileName =
                encodeURIComponent(
                    originalFileName
                );


            // -------------------------------------------------
            // RESPONSE HEADERS
            // -------------------------------------------------

            res.statusCode =
                200;


            res.setHeader(
                "Content-Type",
                objectResult.ContentType ||
                    "application/octet-stream"
            );


            if (
                objectResult.ContentLength !==
                undefined &&
                objectResult.ContentLength !==
                null
            ) {

                res.setHeader(
                    "Content-Length",
                    String(
                        objectResult.ContentLength
                    )
                );
            }


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${originalFileName.replace(/"/g, "")}"; filename*=UTF-8''${encodedFileName}`
            );


            // Prevent browsers/proxies from caching
            // an already-expired download.

            res.setHeader(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, private"
            );


            res.setHeader(
                "Pragma",
                "no-cache"
            );


            res.setHeader(
                "Expires",
                "0"
            );


            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );


            // -------------------------------------------------
            // DOWNLOAD FINISHED
            // -------------------------------------------------

            res.once(
                "finish",
                () => {

                    downloadCompleted =
                        true;


                    console.log(
                        "Download response finished:",
                        key
                    );
                }
            );


            // -------------------------------------------------
            // CLIENT CLOSED CONNECTION
            // -------------------------------------------------

            res.once(
                "close",
                () => {

                    if (
                        !downloadCompleted
                    ) {

                        console.warn(
                            "Download connection closed before completion:",
                            key
                        );
                    }
                }
            );


            // -------------------------------------------------
            // STREAM ERROR
            // -------------------------------------------------

            objectResult.Body.on(
                "error",
                (streamError) => {

                    console.error(
                        "Backblaze download stream error:",
                        streamError
                    );


                    if (
                        !res.headersSent
                    ) {

                        res
                            .status(500)
                            .send(
                                "Download failed while reading the file."
                            );

                    } else {

                        res.destroy(
                            streamError
                        );
                    }
                }
            );


            // -------------------------------------------------
            // PIPE BACKBLAZE STREAM TO CLIENT
            // -------------------------------------------------

            await new Promise(
                (resolve, reject) => {

                    pipeline(
                        objectResult.Body,
                        res,
                        (error) => {

                            if (
                                error
                            ) {

                                console.error(
                                    "Download pipeline error:",
                                    error
                                );

                                reject(
                                    error
                                );

                            } else {

                                resolve();
                            }
                        }
                    );
                }
            );


            // -------------------------------------------------
            // DELETE AFTER SUCCESSFUL DOWNLOAD
            // -------------------------------------------------

            if (
                afterDownloadDelete &&
                downloadCompleted
            ) {

                console.log(
                    "Deleting after successful download:",
                    key
                );


                try {

                    await s3.send(
                        new DeleteObjectCommand({

                            Bucket:
                                BUCKET_NAME,

                            Key:
                                key

                        })
                    );


                    console.log(
                        "File deleted after download:",
                        key
                    );


                } catch (deleteError) {

                    console.error(
                        "After-download deletion failed:",
                        deleteError.message
                    );
                }
            }


        } catch (error) {

            console.error("");
            console.error(
                "========================================"
            );
            console.error(
                "DOWNLOAD ERROR"
            );
            console.error(
                "========================================"
            );

            console.error(
                error
            );


            if (
                !res.headersSent
            ) {

                return res
                    .status(500)
                    .send(
                        "Download failed."
                    );
            }


            if (
                !res.destroyed
            ) {

                res.destroy(
                    error
                );
            }
        }
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
                "Multer error:",
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
            `Frontend: ${projectDirectory}`
        );

        console.log(
            `QR: ${path.join(
                projectDirectory,
                "GooglePay_QR.png"
            )}`
        );

        console.log("");

        console.log(
            "Backblaze:",
            "CONFIGURED"
        );

        console.log(
            "Multipart upload:",
            "ENABLED"
        );

        console.log(
            "Part size:",
            "10 MB"
        );

        console.log(
            "Concurrent parts:",
            "20"
        );

        console.log(
            "Auto Delete:",
            "ENABLED"
        );

        console.log("");

        console.log(
            "Options:"
        );

        console.log(
            "10 Minutes"
        );

        console.log(
            "30 Minutes"
        );

        console.log(
            "1 Hour"
        );

        console.log(
            "After Download (Max 30 Minutes)"
        );

        console.log("");

        console.log(
            "========================================"
        );
    }
);