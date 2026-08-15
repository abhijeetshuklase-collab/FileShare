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

const REGION = process.env.B2_REGION;
const ENDPOINT = process.env.B2_ENDPOINT;
const KEY_ID = process.env.B2_KEY_ID;
const APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const BUCKET_NAME = process.env.B2_BUCKET_NAME;

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
    console.error("ERROR: Missing Backblaze configuration");
    console.error("========================================");
    console.error("");
    console.error("Required variables:");
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

const s3 = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,

    credentials: {
        accessKeyId: KEY_ID,
        secretAccessKey: APPLICATION_KEY
    },

    forcePathStyle: true,

    maxAttempts: 5,

    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
});

// =====================================================
// PROJECT / FRONTEND PATH
// =====================================================
//
// server/app.js
//      ↑
//      |
//      └── ../
//           ├── index.html
//           ├── app.js
//           ├── style.css
//           └── GooglePay_QR.png
//
// =====================================================

const serverDirectory = __dirname;

const projectDirectory = path.resolve(
    __dirname,
    ".."
);

// =====================================================
// TEMPORARY UPLOAD DIRECTORY
// =====================================================

const tempDirectory = path.join(
    os.tmpdir(),
    "fileshare-uploads"
);

if (!fs.existsSync(tempDirectory)) {
    fs.mkdirSync(tempDirectory, {
        recursive: true
    });
}

// =====================================================
// MULTER
// =====================================================

const storage = multer.diskStorage({

    destination: (req, file, cb) => {

        cb(
            null,
            tempDirectory
        );
    },

    filename: (req, file, cb) => {

        const uniqueName =
            `${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 12)}`;

        cb(
            null,
            uniqueName
        );
    }
});

const upload = multer({
    storage: storage
});

// =====================================================
// FRONTEND STATIC FILES
// =====================================================
//
// This serves:
//
// /index.html
// /app.js
// /style.css
// /GooglePay_QR.png
//
// =====================================================

app.use(
    express.static(
        projectDirectory
    )
);

// =====================================================
// EXPLICIT QR CODE ROUTE
// =====================================================
//
// This is the important fix.
//
// Even if the static middleware does not find the
// QR image, this route explicitly serves it.
//
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
            "QR request:"
        );

        console.log(
            "QR path:",
            qrPath
        );

        if (
            !fs.existsSync(qrPath)
        ) {

            console.error(
                "QR CODE FILE NOT FOUND:"
            );

            console.error(
                qrPath
            );

            return res
                .status(404)
                .send(
                    "GooglePay_QR.png not found on server."
                );
        }

        return res.sendFile(
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
            !fs.existsSync(indexPath)
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
            status: "OK",
            server: "FileShare",
            backblaze: "configured"
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

// Each part = 10 MB
const PART_SIZE =
    10 * 1024 * 1024;

// Upload 20 parts simultaneously
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
// MULTIPART UPLOAD
// =====================================================

async function uploadLargeFile(
    filePath,
    key,
    contentType,
    metadata
) {

    let uploadId = null;

    try {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "STARTING BACKBLAZE MULTIPART UPLOAD"
        );

        console.log(
            "========================================"
        );

        // -------------------------------------------------
        // START MULTIPART UPLOAD
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

        if (!uploadId) {

            throw new Error(
                "Backblaze did not return UploadId."
            );
        }

        console.log(
            "Multipart Upload ID:",
            uploadId
        );

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
            "Concurrent uploads:",
            CONCURRENT_PARTS
        );

        // -------------------------------------------------
        // UPLOAD PARTS
        // -------------------------------------------------

        const completedParts = [];

        for (
            let batchStart = 1;
            batchStart <= totalParts;
            batchStart += CONCURRENT_PARTS
        ) {

            const batchEnd =
                Math.min(
                    batchStart +
                    CONCURRENT_PARTS -
                    1,
                    totalParts
                );

            console.log("");

            console.log(
                `Uploading parts ${batchStart}-${batchEnd}/${totalParts}...`
            );

            const batchPromises = [];

            for (
                let partNumber = batchStart;
                partNumber <= batchEnd;
                partNumber++
            ) {

                batchPromises.push(
                    uploadSinglePart(
                        filePath,
                        fileSize,
                        key,
                        uploadId,
                        partNumber
                    )
                );
            }

            const batchResults =
                await Promise.all(
                    batchPromises
                );

            for (
                const result
                of batchResults
            ) {

                completedParts.push(
                    result
                );
            }

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

        console.log("");

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
            "Multipart upload completed successfully."
        );

        return true;

    } catch (error) {

        // -------------------------------------------------
        // ABORT FAILED MULTIPART UPLOAD
        // -------------------------------------------------

        if (uploadId) {

            try {

                console.log(
                    "Aborting incomplete multipart upload..."
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
                    "Incomplete multipart upload aborted."
                );

            } catch (
                abortError
            ) {

                console.error(
                    "Abort failed:",
                    abortError.message
                );
            }
        }

        throw error;
    }
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
        (partNumber - 1) *
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
        `Starting part ${partNumber}...`
    );

    const body =
        fs.createReadStream(
            filePath,
            {
                start:
                    start,

                end:
                    end - 1
            }
        );

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
                    body,

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

        ETag:
            result.ETag,

        PartNumber:
            partNumber

    };
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
                            "Auto delete successful:",
                            object.Key
                        );
                    }

                } catch (
                    error
                ) {

                    console.error(
                        "Checking file failed:",
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

    } catch (
        error
    ) {

        console.error(
            "Auto delete cleanup error:",
            error.message
        );
    }
}

// =====================================================
// RUN AUTO DELETE CLEANUP
// =====================================================

setInterval(
    cleanupExpiredFiles,
    60 * 1000
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
            "UPLOAD REQUEST RECEIVED"
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
            // AUTO DELETE METADATA
            // -------------------------------------------------

            const metadata = {};

            let deleteAt;

            if (
                isAfterDownload
            ) {

                // Maximum 30 minutes if nobody downloads it.

                deleteAt =
                    Date.now() +
                    (
                        30 *
                        60 *
                        1000
                    );

                metadata.deletemode =
                    "after-download";

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
                "Type:",
                req.file.mimetype
            );

            console.log(
                "Temporary file:",
                temporaryFilePath
            );

            if (
                isAfterDownload
            ) {

                console.log(
                    "Auto Delete:",
                    "After Download (Max 30 Minutes)"
                );

            } else {

                console.log(
                    "Auto Delete:",
                    new Date(
                        deleteAt
                    ).toLocaleString()
                );
            }

            // -------------------------------------------------
            // BACKBLAZE MULTIPART UPLOAD
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

                    message:
                        "File uploaded successfully.",

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

        } catch (
            error
        ) {

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
                "Error:",
                error.message
            );

            console.error(
                "Code:",
                error.Code ||
                error.code ||
                "N/A"
            );

            console.error(
                "HTTP status:",
                error.$metadata?.httpStatusCode ||
                "N/A"
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
            // REMOVE TEMPORARY FILE
            // -------------------------------------------------

            if (
                temporaryFilePath
            ) {

                try {

                    await fs.promises.unlink(
                        temporaryFilePath
                    );

                    console.log(
                        "Temporary file removed."
                    );

                } catch (
                    cleanupError
                ) {

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

        try {

            const key =
                req.params.key;

            if (
                !key
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid download request."
                    );
            }

            console.log(
                "Download request:",
                key
            );

            // -------------------------------------------------
            // CHECK FILE
            // -------------------------------------------------

            const headResult =
                await s3.send(
                    new HeadObjectCommand({

                        Bucket:
                            BUCKET_NAME,

                        Key:
                            key

                    })
                );

            const metadata =
                headResult.Metadata ||
                {};

            const isAfterDownload =
                metadata.deletemode ===
                "after-download";

            // -------------------------------------------------
            // GET FILE
            // -------------------------------------------------

            const result =
                await s3.send(
                    new GetObjectCommand({

                        Bucket:
                            BUCKET_NAME,

                        Key:
                            key

                    })
                );

            // -------------------------------------------------
            // RESPONSE HEADERS
            // -------------------------------------------------

            if (
                result.ContentType
            ) {

                res.setHeader(
                    "Content-Type",
                    result.ContentType
                );
            }

            if (
                result.ContentLength !==
                undefined
            ) {

                res.setHeader(
                    "Content-Length",
                    result.ContentLength
                );
            }

            const originalName =
                path
                    .basename(
                        key
                    )
                    .replace(
                        /^\d+-/,
                        ""
                    );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${originalName}"`
            );

            // -------------------------------------------------
            // AFTER DOWNLOAD DELETE
            // -------------------------------------------------

            if (
                isAfterDownload
            ) {

                res.on(
                    "finish",
                    async () => {

                        try {

                            console.log(
                                "Download completed."
                            );

                            console.log(
                                "Deleting file:",
                                key
                            );

                            await s3.send(
                                new DeleteObjectCommand({

                                    Bucket:
                                        BUCKET_NAME,

                                    Key:
                                        key

                                })
                            );

                            console.log(
                                "File deleted after download."
                            );

                        } catch (
                            error
                        ) {

                            console.error(
                                "After-download delete failed:",
                                error.message
                            );
                        }
                    }
                );
            }

            // -------------------------------------------------
            // STREAM FILE
            // -------------------------------------------------

            if (
                result.Body &&
                typeof result.Body.pipe ===
                "function"
            ) {

                result.Body.pipe(
                    res
                );

            } else {

                const data =
                    await result.Body
                        .transformToByteArray();

                res.end(
                    Buffer.from(
                        data
                    )
                );
            }

        } catch (
            error
        ) {

            console.error(
                "DOWNLOAD ERROR:",
                error.message
            );

            if (
                !res.headersSent
            ) {

                if (
                    error.name ===
                    "NoSuchKey" ||
                    error.$metadata?.httpStatusCode ===
                    404
                ) {

                    return res
                        .status(404)
                        .send(
                            "File not found. It may have already been automatically deleted."
                        );
                }

                return res
                    .status(500)
                    .send(
                        "Download failed."
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
                "MULTER ERROR:",
                error.message
            );

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Upload error",

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

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Server error",

                    details:
                        error.message

                });
        }
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
            `http://localhost:${PORT}`
        );

        console.log("");

        console.log(
            "Frontend:",
            projectDirectory
        );

        console.log(
            "QR Code:",
            path.join(
                projectDirectory,
                "GooglePay_QR.png"
            )
        );

        console.log("");

        console.log(
            "Large-file upload: MULTIPART"
        );

        console.log(
            "Part size: 10 MB"
        );

        console.log(
            "Concurrent parts: 20"
        );

        console.log(
            "Auto Delete: ENABLED"
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
            "Key ID loaded:",
            !!KEY_ID
        );

        console.log(
            "Application key loaded:",
            !!APPLICATION_KEY
        );

        console.log("");

        console.log(
            "========================================"
        );

        console.log("");
    }
);