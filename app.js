"use strict";

const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PassThrough } = require("stream");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    GetObjectCommand,
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
// FRONTEND DIRECTORY
// =====================================================

const frontendPath =
    path.resolve(
        __dirname,
        ".."
    );


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
            recursive: true
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
        storage: storage
    });


// =====================================================
// STATIC FRONTEND
// =====================================================

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
// QR CODE
// =====================================================

app.get(
    "/GooglePay_QR.png",
    (req, res) => {

        const qrPath =
            path.join(
                frontendPath,
                "GooglePay_QR.png"
            );

        if (
            !fs.existsSync(
                qrPath
            )
        ) {

            return res
                .status(404)
                .send(
                    "QR code not found."
                );
        }

        res.sendFile(
            qrPath
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
            status: "OK",
            server: "FileShare",
            backblaze: "configured"
        });
    }
);


// =====================================================
// AUTO DELETE
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
        // START MULTIPART
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
        // UPLOAD 20 PARTS AT A TIME
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
        // ABORT FAILED MULTIPART
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
                    }


                } catch (error) {

                    console.error(
                        "Cleanup error:",
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
            // FILE CHECK
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

                // Delete after successful download,
                // or after maximum 30 minutes.

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


            // -------------------------------------------------
            // UPLOAD
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
                            "Upload failed.",

                        details:
                            error.message
                    });
            }


        } finally {

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
// DOWNLOAD ROUTE
// =====================================================
//
// IMPORTANT:
// This route supports HTTP Range requests.
// This is important for Android/mobile browsers
// and download managers.
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


        try {

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
                "Key:",
                key
            );


            // -------------------------------------------------
            // HEAD OBJECT
            // -------------------------------------------------

            let head;


            try {

                head =
                    await s3.send(
                        new HeadObjectCommand({

                            Bucket:
                                BUCKET_NAME,

                            Key:
                                key
                        })
                    );


            } catch (error) {

                console.error(
                    "HeadObject error:",
                    error.message
                );


                return res
                    .status(404)
                    .send(
                        "File not found or it has expired."
                    );
            }


            const fileSize =
                Number(
                    head.ContentLength
                );


            if (
                !Number.isFinite(
                    fileSize
                ) ||
                fileSize < 0
            ) {

                return res
                    .status(500)
                    .send(
                        "Invalid file size."
                    );
            }


            // -------------------------------------------------
            // AUTO DELETE CHECK
            // -------------------------------------------------

            const metadata =
                head.Metadata ||
                {};


            const isAfterDownload =
                metadata.deletemode ===
                "after-download";


            if (
                metadata.deleteat
            ) {

                const deleteAt =
                    Number(
                        metadata.deleteat
                    );


                if (
                    Number.isFinite(
                        deleteAt
                    ) &&
                    Date.now() >=
                        deleteAt
                ) {

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
                            "Expired delete error:",
                            deleteError.message
                        );
                    }


                    return res
                        .status(410)
                        .send(
                            "This file has expired."
                        );
                }
            }


            // -------------------------------------------------
            // FILE NAME
            // -------------------------------------------------

            let fileName =
                path.basename(
                    key
                );


            fileName =
                fileName.replace(
                    /^\d+-/,
                    ""
                );


            fileName =
                fileName.replace(
                    /["\r\n]/g,
                    "_"
                );


            const encodedFileName =
                encodeURIComponent(
                    fileName
                );


            // -------------------------------------------------
            // CONTENT TYPE
            // -------------------------------------------------

            const contentType =
                head.ContentType ||
                "application/octet-stream";


            // -------------------------------------------------
            // RANGE REQUEST
            // -------------------------------------------------

            const range =
                req.headers.range;


            let start =
                0;

            let end =
                fileSize -
                1;


            let partial =
                false;


            if (
                range
            ) {

                const match =
                    /^bytes=(\d*)-(\d*)$/i.exec(
                        range
                    );


                if (
                    !match
                ) {

                    res.setHeader(
                        "Content-Range",
                        `bytes */${fileSize}`
                    );


                    return res
                        .status(416)
                        .send(
                            "Invalid byte range."
                        );
                }


                const requestedStart =
                    match[1] === ""
                        ? null
                        : Number(
                            match[1]
                        );


                const requestedEnd =
                    match[2] === ""
                        ? null
                        : Number(
                            match[2]
                        );


                if (
                    requestedStart ===
                    null
                ) {

                    const suffixLength =
                        requestedEnd;


                    if (
                        !Number.isFinite(
                            suffixLength
                        ) ||
                        suffixLength <= 0
                    ) {

                        res.setHeader(
                            "Content-Range",
                            `bytes */${fileSize}`
                        );


                        return res
                            .status(416)
                            .send(
                                "Invalid byte range."
                            );
                    }


                    start =
                        Math.max(
                            fileSize -
                            suffixLength,

                            0
                        );


                } else {

                    start =
                        requestedStart;


                    if (
                        requestedEnd !==
                        null
                    ) {

                        end =
                            requestedEnd;
                    }
                }


                if (
                    start < 0 ||
                    start >= fileSize
                ) {

                    res.setHeader(
                        "Content-Range",
                        `bytes */${fileSize}`
                    );


                    return res
                        .status(416)
                        .send(
                            "Requested range is not satisfiable."
                        );
                }


                if (
                    end >= fileSize
                ) {

                    end =
                        fileSize -
                        1;
                }


                if (
                    end < start
                ) {

                    res.setHeader(
                        "Content-Range",
                        `bytes */${fileSize}`
                    );


                    return res
                        .status(416)
                        .send(
                            "Requested range is not satisfiable."
                        );
                }


                partial =
                    true;
            }


            const contentLength =
                end -
                start +
                1;


            // -------------------------------------------------
            // RESPONSE HEADERS
            // -------------------------------------------------

            res.setHeader(
                "Accept-Ranges",
                "bytes"
            );


            res.setHeader(
                "Content-Type",
                contentType
            );


            res.setHeader(
                "Content-Length",
                String(
                    contentLength
                )
            );


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`
            );


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


            if (
                partial
            ) {

                res.statusCode =
                    206;


                res.setHeader(
                    "Content-Range",
                    `bytes ${start}-${end}/${fileSize}`
                );

            } else {

                res.statusCode =
                    200;
            }


            // -------------------------------------------------
            // GET OBJECT FROM BACKBLAZE
            // -------------------------------------------------

            const object =
                await s3.send(
                    new GetObjectCommand({

                        Bucket:
                            BUCKET_NAME,

                        Key:
                            key,

                        ...(partial
                            ? {
                                Range:
                                    `bytes=${start}-${end}`
                            }
                            : {})
                    })
                );


            if (
                !object.Body
            ) {

                return res
                    .status(500)
                    .send(
                        "Download failed: empty file stream."
                    );
            }


            // -------------------------------------------------
            // STREAM
            // -------------------------------------------------

            let completed =
                false;


            object.Body.on(
                "error",
                (error) => {

                    console.error(
                        "Backblaze download stream error:",
                        error.message
                    );


                    if (
                        !res.headersSent
                    ) {

                        res
                            .status(500)
                            .end();

                    } else if (
                        !res.destroyed
                    ) {

                        res.destroy(
                            error
                        );
                    }
                }
            );


            res.on(
                "finish",
                () => {

                    completed =
                        true;


                    console.log(
                        "Download completed:",
                        key
                    );


                    // -----------------------------------------
                    // AFTER DOWNLOAD DELETE
                    // -----------------------------------------

                    if (
                        isAfterDownload
                    ) {

                        s3.send(
                            new DeleteObjectCommand({

                                Bucket:
                                    BUCKET_NAME,

                                Key:
                                    key
                            })
                        )
                            .then(
                                () => {

                                    console.log(
                                        "File deleted after download:",
                                        key
                                    );
                                }
                            )
                            .catch(
                                (error) => {

                                    console.error(
                                        "After-download deletion failed:",
                                        error.message
                                    );
                                }
                            );
                    }
                }
            );


            res.on(
                "close",
                () => {

                    if (
                        !completed
                    ) {

                        console.log(
                            "Download connection closed before completion:",
                            key
                        );
                    }
                }
            );


            object.Body.pipe(
                res
            );


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
                    .status(
                        error.$metadata?.httpStatusCode ===
                        404
                            ? 404
                            : 500
                    )
                    .send(
                        error.$metadata?.httpStatusCode ===
                        404
                            ? "File not found."
                            : "Download failed."
                    );
            }


            if (
                !res.destroyed
            ) {

                res.destroy();
            }
        }
    }
);


// =====================================================
// MULTER ERROR
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
// GENERAL ERROR
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
            "20 concurrent parts"
        );

        console.log(
            "Part size:",
            "10 MB"
        );

        console.log(
            "Mobile Range Downloads:",
            "ENABLED"
        );

        console.log(
            "Auto Delete:",
            "ENABLED"
        );

        console.log(
            "QR Code:",
            "ENABLED"
        );

        console.log(
            "========================================"
        );
    }
);