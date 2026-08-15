const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURATION
// =====================================================

const REGION = process.env.B2_REGION;
const ENDPOINT = process.env.B2_ENDPOINT;
const KEY_ID = process.env.B2_KEY_ID;
const APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const BUCKET_NAME = process.env.B2_BUCKET_NAME;

// =====================================================
// CHECK ENVIRONMENT VARIABLES
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
    console.error("Check your .env file.");
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

    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
});

// =====================================================
// MULTER
// =====================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 100 * 1024 * 1024
    }
});

// =====================================================
// FRONTEND
// =====================================================

const frontendPath = path.join(__dirname, "..");

app.use(express.static(frontendPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        server: "FileShare",
        backblaze: "configured"
    });
});

// =====================================================
// UPLOAD
// =====================================================

app.post("/upload", upload.single("file"), async (req, res) => {

    console.log("");
    console.log("========================================");
    console.log("UPLOAD REQUEST RECEIVED");
    console.log("========================================");

    try {

        // -------------------------------------------------
        // CHECK FILE
        // -------------------------------------------------

        if (!req.file) {

            console.log("ERROR: No file received.");

            return res.status(400).json({
                success: false,
                error: "No file received."
            });
        }

        console.log("File name:", req.file.originalname);
        console.log("File size:", req.file.size);
        console.log("File type:", req.file.mimetype);
        console.log("Buffer size:", req.file.buffer.length);

        // -------------------------------------------------
        // SAFE FILE NAME
        // -------------------------------------------------

        const cleanFileName = path
            .basename(req.file.originalname)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

        const key = `${Date.now()}-${cleanFileName}`;

        console.log("");
        console.log("Uploading to Backblaze...");
        console.log("Bucket:", BUCKET_NAME);
        console.log("Key:", key);
        console.log("Size:", req.file.buffer.length);

        // -------------------------------------------------
        // BACKBLAZE UPLOAD
        // -------------------------------------------------

        const command = new PutObjectCommand({

            Bucket: BUCKET_NAME,

            Key: key,

            Body: req.file.buffer,

            ContentLength: req.file.buffer.length,

            ContentType:
                req.file.mimetype || "application/octet-stream"
        });

        await s3.send(command);

        // -------------------------------------------------
        // DOWNLOAD LINK
        // -------------------------------------------------

        const downloadUrl =
            `/download/${encodeURIComponent(key)}`;

        // -------------------------------------------------
        // SUCCESS
        // -------------------------------------------------

        console.log("");
        console.log("========================================");
        console.log("UPLOAD SUCCESSFUL");
        console.log("========================================");

        console.log("File:", cleanFileName);
        console.log("Key:", key);
        console.log("Download:", downloadUrl);

        console.log("");

        return res.status(200).json({

            success: true,

            message: "File uploaded successfully.",

            fileName: cleanFileName,

            key: key,

            downloadUrl: downloadUrl
        });

    } catch (error) {

        console.log("");
        console.log("========================================");
        console.log("BACKBLAZE UPLOAD ERROR");
        console.log("========================================");

        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error(
            "Error code:",
            error.Code || error.code || "N/A"
        );

        console.error(
            "HTTP status:",
            error.$metadata?.httpStatusCode || "N/A"
        );

        console.log("========================================");
        console.log("");

        return res.status(500).json({

            success: false,

            error: "Upload failed",

            details: error.message
        });
    }
});

// =====================================================
// DOWNLOAD
// =====================================================

app.get("/download/:key", async (req, res) => {

    console.log("");
    console.log("========================================");
    console.log("DOWNLOAD REQUEST");
    console.log("========================================");

    try {

        const key = req.params.key;

        if (!key) {

            return res.status(400).send(
                "Invalid download request."
            );
        }

        console.log("Requested key:", key);

        // -------------------------------------------------
        // GET FILE FROM BACKBLAZE
        // -------------------------------------------------

        const command = new GetObjectCommand({

            Bucket: BUCKET_NAME,

            Key: key
        });

        const result = await s3.send(command);

        // -------------------------------------------------
        // FILE HEADERS
        // -------------------------------------------------

        if (result.ContentType) {

            res.setHeader(
                "Content-Type",
                result.ContentType
            );
        }

        if (result.ContentLength) {

            res.setHeader(
                "Content-Length",
                result.ContentLength
            );
        }

        // Force browser download
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${path.basename(key).replace(/^\d+-/, "")}"`
        );

        // -------------------------------------------------
        // STREAM FILE TO USER
        // -------------------------------------------------

        if (result.Body && typeof result.Body.pipe === "function") {

            result.Body.pipe(res);

        } else {

            const data = await result.Body.transformToByteArray();

            res.end(Buffer.from(data));
        }

        console.log("DOWNLOAD STARTED");

    } catch (error) {

        console.error("");
        console.error("========================================");
        console.error("DOWNLOAD ERROR");
        console.error("========================================");

        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error(
            "HTTP status:",
            error.$metadata?.httpStatusCode || "N/A"
        );

        console.error("========================================");

        if (!res.headersSent) {

            if (
                error.name === "NoSuchKey" ||
                error.$metadata?.httpStatusCode === 404
            ) {

                return res.status(404).send(
                    "File not found."
                );
            }

            return res.status(500).send(
                "Download failed."
            );
        }
    }
});

// =====================================================
// MULTER ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {

    if (error instanceof multer.MulterError) {

        console.error(
            "MULTER ERROR:",
            error.message
        );

        return res.status(400).json({

            success: false,

            error: "Upload error",

            details: error.message
        });
    }

    next(error);
});

// =====================================================
// GENERAL ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {

    console.error("SERVER ERROR:", error);

    res.status(500).json({

        success: false,

        error: "Server error",

        details: error.message
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log("");
    console.log("========================================");
    console.log("BACKBLAZE CONFIGURATION");
    console.log("========================================");

    console.log("Region:", REGION);
    console.log("Endpoint:", ENDPOINT);
    console.log("Bucket:", BUCKET_NAME);
    console.log("Key ID loaded:", !!KEY_ID);
    console.log(
        "Application key loaded:",
        !!APPLICATION_KEY
    );

    console.log("========================================");
    console.log("");

    console.log("========================================");
    console.log("FILESHARE SERVER RUNNING");
    console.log("========================================");

    console.log(`Server running on port ${PORT}`);

    console.log("");

    console.log(
        "Frontend:",
        path.join(frontendPath, "index.html")
    );

    console.log("========================================");
    console.log("");
});