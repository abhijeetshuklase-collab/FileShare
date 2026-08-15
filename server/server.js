"use strict";

const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();


// =====================================================
// PORT
// =====================================================

const PORT =
    Number(process.env.PORT) || 3000;


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
// CONFIGURATION CHECK
// =====================================================

const missingConfiguration = [];

if (!REGION) {
    missingConfiguration.push("B2_REGION");
}

if (!ENDPOINT) {
    missingConfiguration.push("B2_ENDPOINT");
}

if (!KEY_ID) {
    missingConfiguration.push("B2_KEY_ID");
}

if (!APPLICATION_KEY) {
    missingConfiguration.push("B2_APPLICATION_KEY");
}

if (!BUCKET_NAME) {
    missingConfiguration.push("B2_BUCKET_NAME");
}

if (missingConfiguration.length > 0) {

    console.error("");
    console.error("========================================");
    console.error("MISSING BACKBLAZE CONFIGURATION");
    console.error("========================================");
    console.error(
        missingConfiguration.join(", ")
    );
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
// MULTER STORAGE
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
                    `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;

                cb(
                    null,
                    uniqueName
                );
            }
    });


const upload =
    multer({

        storage:

            storage,

        limits: {

            // 10 GB maximum temporary upload size
            fileSize:
                10 *
                1024 *
                1024 *
                1024
        }
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
                "configured",

            download:
                "enabled"
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


// Upload parts in batches
const CONCURRENT_PARTS =
    10;


// =====================================================
// SAFE FILE NAME
// =====================================================

function safeFileName(
    originalName
) {

    let name =
        path.basename(
            originalName ||
            "download"
        );

    name =
        name.replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        );

    name =
        name.trim();

    if (!name) {
        name =
            "download";
    }

    return name;
}


// =====================================================
// ERROR MESSAGE HELPER
// =====================================================

function getErrorDetails(
    error
) {

    if (!error) {
        return "Unknown error.";
    }

    return {

        name:
            error.name ||
            "UnknownError",

        message:
            error.message ||
            String(error),

        code:
            error.Code ||
            error.code ||
            "N/A",

        status:
            error.$metadata?.httpStatusCode ||
            error.statusCode ||
            "N/A",

        requestId:
            error.$metadata?.requestId ||
            "N/A"
    };
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

        if (
            fileSize ===
            0
        ) {

            throw new Error(
                "Empty files are not supported."
            );
        }

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
        // COMPLETE MULTIPART UPLOAD
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
                    getErrorDetails(
                        abortError
                    )
                );
            }
        }

        throw error;
    }
}


// =====================================================
// FILE KEY FORMAT
// =====================================================
//
// New files use:
//
// FS1-<deleteTimestamp>-<mode>-<random>-<filename>
//
// Example:
//
// FS1-1786818000000-timed-a8f93d12-file.pdf
//
// This allows cleanup without HeadObject.
// =====================================================

function createFileKey(
    deleteAt,
    mode,
    fileName
) {

    const random =
        crypto
            .randomBytes(10)
            .toString("hex");

    return (
        `FS1-${deleteAt}-${mode}-${random}-${fileName}`
    );
}


// =====================================================
// PARSE NEW FILE KEY
// =====================================================

function parseFileKey(
    key
) {

    const match =
        /^FS1-(\d+)-(timed|after-download)-([a-f0-9]+)-(.+)$/i.exec(
            key
        );

    if (
        !match
    ) {

        return null;
    }

    return {

        deleteAt:
            Number(
                match[1]
            ),

        mode:
            match[2].toLowerCase(),

        random:
            match[3],

        fileName:
            match[4]
    };
}


// =====================================================
// GET FILE NAME FROM KEY
// =====================================================

function getFileNameFromKey(
    key
) {

    const parsed =
        parseFileKey(
            key
        );

    if (
        parsed
    ) {

        return safeFileName(
            parsed.fileName
        );
    }

    // Compatibility with old files
    const oldName =
        path.basename(
            key
        );

    return safeFileName(
        oldName.replace(
            /^\d+-/,
            ""
        )
    );
}


// =====================================================
// AUTO DELETE CLEANUP
// =====================================================
//
// IMPORTANT:
// No HeadObject is used here.
//
// New files contain their expiry timestamp
// directly inside their key.
// =====================================================

async function cleanupExpiredFiles() {

    try {

        let continuationToken =
            undefined;

        let checked =
            0;

        let deleted =
            0;

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

                checked++;

                const parsed =
                    parseFileKey(
                        object.Key
                    );

                // Old files are left alone.
                // New files have expiration in key.
                if (
                    !parsed
                ) {

                    continue;
                }

                if (
                    !Number.isFinite(
                        parsed.deleteAt
                    )
                ) {

                    continue;
                }

                if (
                    Date.now() <
                    parsed.deleteAt
                ) {

                    continue;
                }

                try {

                    console.log(
                        "Auto deleting expired file:",
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

                    deleted++;

                } catch (deleteError) {

                    console.error(
                        "Delete failed:",
                        object.Key,
                        getErrorDetails(
                            deleteError
                        )
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

        if (
            checked >
            0
        ) {

            console.log(
                `Cleanup checked ${checked} objects; deleted ${deleted}.`
            );
        }

    } catch (error) {

        console.error(
            "Cleanup failed:",
            getErrorDetails(
                error
            )
        );
    }
}


// Run cleanup every minute.
setInterval(
    cleanupExpiredFiles,
    60 *
    1000
);


// Initial cleanup after startup.
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
                Object.prototype.hasOwnProperty.call(
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

            // -------------------------------------------------
            // EXPIRATION
            // -------------------------------------------------

            let deleteAt;
            let mode;

            if (
                isAfterDownload
            ) {

                // Maximum 30 minutes.
                deleteAt =
                    Date.now() +
                    (
                        30 *
                        60 *
                        1000
                    );

                mode =
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

                mode =
                    "timed";
            }

            // -------------------------------------------------
            // KEY
            // -------------------------------------------------

            const key =
                createFileKey(
                    deleteAt,
                    mode,
                    fileName
                );

            // -------------------------------------------------
            // METADATA
            // -------------------------------------------------

            const metadata = {

                deleteat:
                    String(
                        deleteAt
                    ),

                deletemode:
                    mode
            };

            console.log(
                "Original filename:",
                fileName
            );

            console.log(
                "Size:",
                req.file.size
            );

            console.log(
                "Delete mode:",
                mode
            );

            console.log(
                "Delete at:",
                new Date(
                    deleteAt
                ).toISOString()
            );

            console.log(
                "B2 object key:",
                key
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
                        mode,

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
                getErrorDetails(
                    error
                )
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
                            error.message ||
                            "Unknown error."
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
//
// This route DOES NOT use HeadObject.
//
// It calls GetObject directly.
//
// This is the main fix for the UnknownError
// shown in your Render logs.
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

        try {

            // -------------------------------------------------
            // RANGE
            // -------------------------------------------------

            const range =
                req.headers.range;

            let requestedRange =
                undefined;

            if (
                range
            ) {

                const validRange =
                    /^bytes=(\d*)-(\d*)$/i.test(
                        range
                    );

                if (
                    !validRange
                ) {

                    res.setHeader(
                        "Content-Range",
                        "bytes */*"
                    );

                    return res
                        .status(416)
                        .send(
                            "Invalid byte range."
                        );
                }

                requestedRange =
                    range;
            }

            // -------------------------------------------------
            // GET OBJECT DIRECTLY
            // -------------------------------------------------

            const commandInput = {

                Bucket:
                    BUCKET_NAME,

                Key:
                    key
            };

            if (
                requestedRange
            ) {

                commandInput.Range =
                    requestedRange;
            }

            console.log(
                "Requesting object from Backblaze..."
            );

            const object =
                await s3.send(
                    new GetObjectCommand(
                        commandInput
                    )
                );

            // -------------------------------------------------
            // CHECK BODY
            // -------------------------------------------------

            if (
                !object.Body
            ) {

                console.error(
                    "Backblaze returned an empty Body."
                );

                return res
                    .status(500)
                    .send(
                        "Download failed: empty file stream."
                    );
            }

            // -------------------------------------------------
            // FILE INFORMATION
            // -------------------------------------------------

            const fileName =
                getFileNameFromKey(
                    key
                );

            const contentType =
                object.ContentType ||
                "application/octet-stream";

            const contentLength =
                Number(
                    object.ContentLength
                );

            const contentRange =
                object.ContentRange;

            const acceptRanges =
                object.AcceptRanges ||
                "bytes";

            const metadata =
                object.Metadata ||
                {};

            // -------------------------------------------------
            // EXPIRATION CHECK
            // -------------------------------------------------

            let deleteAt =
                null;

            const parsedKey =
                parseFileKey(
                    key
                );

            if (
                parsedKey
            ) {

                deleteAt =
                    parsedKey.deleteAt;

            } else if (
                metadata.deleteat
            ) {

                deleteAt =
                    Number(
                        metadata.deleteat
                    );
            }

            if (
                Number.isFinite(
                    deleteAt
                ) &&
                Date.now() >=
                deleteAt
            ) {

                console.log(
                    "File has expired:",
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

                } catch (deleteError) {

                    console.error(
                        "Expired file deletion failed:",
                        getErrorDetails(
                            deleteError
                        )
                    );
                }

                return res
                    .status(410)
                    .send(
                        "This file has expired."
                    );
            }

            // -------------------------------------------------
            // DOWNLOAD MODE
            // -------------------------------------------------

            const downloadMode =
                parsedKey?.mode ||
                metadata.deletemode ||
                "timed";

            const isAfterDownload =
                downloadMode ===
                "after-download";

            // -------------------------------------------------
            // RESPONSE HEADERS
            // -------------------------------------------------

            res.setHeader(
                "Content-Type",
                contentType
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${fileName.replace(/["\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
            );

            res.setHeader(
                "Accept-Ranges",
                acceptRanges
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
                object.ETag
            ) {

                res.setHeader(
                    "ETag",
                    object.ETag
                );
            }

            if (
                object.LastModified
            ) {

                res.setHeader(
                    "Last-Modified",
                    object.LastModified.toUTCString()
                );
            }

            // -------------------------------------------------
            // RANGE RESPONSE
            // -------------------------------------------------

            if (
                requestedRange
            ) {

                if (
                    contentRange
                ) {

                    res.status(
                        206
                    );

                    res.setHeader(
                        "Content-Range",
                        contentRange
                    );

                } else {

                    // Some S3-compatible responses may not
                    // expose ContentRange. Still return 206
                    // when Range was requested.

                    res.status(
                        206
                    );
                }

                if (
                    Number.isFinite(
                        contentLength
                    )
                ) {

                    res.setHeader(
                        "Content-Length",
                        String(
                            contentLength
                        )
                    );
                }

            } else {

                res.status(
                    200
                );

                if (
                    Number.isFinite(
                        contentLength
                    )
                ) {

                    res.setHeader(
                        "Content-Length",
                        String(
                            contentLength
                        )
                    );
                }
            }

            console.log(
                "Content-Type:",
                contentType
            );

            console.log(
                "Content-Length:",
                contentLength
            );

            console.log(
                "Content-Range:",
                contentRange ||
                "none"
            );

            console.log(
                "Range requested:",
                requestedRange ||
                "none"
            );

            console.log(
                "Download mode:",
                downloadMode
            );

            // -------------------------------------------------
            // STREAM
            // -------------------------------------------------

            let streamCompleted =
                false;

            const body =
                object.Body;

            try {

                await pipeline(
                    body,
                    res
                );

                streamCompleted =
                    true;

                console.log(
                    "Download stream completed:",
                    key
                );

            } catch (streamError) {

                console.error(
                    "Download stream error:",
                    getErrorDetails(
                        streamError
                    )
                );

                if (
                    !res.destroyed
                ) {

                    res.destroy();
                }

                return;
            }

            // -------------------------------------------------
            // AFTER DOWNLOAD DELETE
            // -------------------------------------------------
            //
            // Only delete after a complete non-range
            // download. This prevents a Range request from
            // deleting the file before the browser has all
            // pieces.
            // -------------------------------------------------

            if (
                streamCompleted &&
                isAfterDownload &&
                !requestedRange
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

                    console.log(
                        "File deleted after successful download:",
                        key
                    );

                } catch (deleteError) {

                    console.error(
                        "After-download deletion failed:",
                        getErrorDetails(
                            deleteError
                        )
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
                getErrorDetails(
                    error
                )
            );

            // -------------------------------------------------
            // NOT FOUND
            // -------------------------------------------------

            const status =
                error?.$metadata?.httpStatusCode ||
                error?.statusCode;

            if (
                status ===
                404 ||
                error?.name ===
                "NoSuchKey"
            ) {

                if (
                    !res.headersSent
                ) {

                    return res
                        .status(404)
                        .send(
                            "File not found or it has expired."
                        );
                }

                return;
            }

            // -------------------------------------------------
            // ACCESS DENIED
            // -------------------------------------------------

            if (
                status ===
                403 ||
                error?.name ===
                "AccessDenied"
            ) {

                if (
                    !res.headersSent
                ) {

                    return res
                        .status(403)
                        .send(
                            "Download access denied."
                        );
                }

                return;
            }

            // -------------------------------------------------
            // RANGE ERROR
            // -------------------------------------------------

            if (
                status ===
                416
            ) {

                if (
                    !res.headersSent
                ) {

                    res.setHeader(
                        "Content-Range",
                        "bytes */*"
                    );

                    return res
                        .status(416)
                        .send(
                            "Requested range is not satisfiable."
                        );
                }

                return;
            }

            // -------------------------------------------------
            // GENERAL DOWNLOAD ERROR
            // -------------------------------------------------

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

                res.destroy();
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

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res
                    .status(413)
                    .json({

                        success:
                            false,

                        error:
                            "File is too large. Maximum size is 10 GB."
                    });
            }

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
            getErrorDetails(
                error
            )
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
                        error.message ||
                        "Unknown error."
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
    "0.0.0.0",
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
            "Port:",
            PORT
        );

        console.log(
            "Backblaze endpoint:",
            ENDPOINT
        );

        console.log(
            "Bucket:",
            BUCKET_NAME
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
            CONCURRENT_PARTS
        );

        console.log(
            "Direct GetObject downloads:",
            "ENABLED"
        );

        console.log(
            "HTTP Range downloads:",
            "ENABLED"
        );

        console.log(
            "Mobile downloads:",
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