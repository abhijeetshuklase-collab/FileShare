"use strict";

document.addEventListener("DOMContentLoaded", () => {

    console.log("FileShare app.js loaded successfully.");

    // =====================================================
    // GET ELEMENTS
    // =====================================================

    const fileInput = document.getElementById("fileInput");
    const deleteAfter = document.getElementById("deleteAfter");
    const uploadBtn = document.getElementById("uploadBtn");

    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");
    const status = document.getElementById("status");

    const downloadResult = document.getElementById("downloadResult");
    const downloadBtn = document.getElementById("downloadBtn");
    const copyBtn = document.getElementById("copyBtn");
    const copyStatus = document.getElementById("copyStatus");
    const downloadLinkText = document.getElementById("downloadLinkText");
    const fileReady = document.getElementById("fileReady");
    const expiryText = document.getElementById("expiryText");


    // =====================================================
    // CHECK ONLY ESSENTIAL UPLOAD ELEMENTS
    // =====================================================

    if (!fileInput) {
        console.error("FileShare error: #fileInput not found.");
        return;
    }

    if (!uploadBtn) {
        console.error("FileShare error: #uploadBtn not found.");
        return;
    }

    if (!deleteAfter) {
        console.error("FileShare error: #deleteAfter not found.");
        return;
    }

    console.log("All upload elements found.");


    // =====================================================
    // CURRENT DOWNLOAD URL
    // =====================================================

    let currentDownloadUrl = "";


    // =====================================================
    // RESET DOWNLOAD AREA
    // =====================================================

    function resetDownloadArea() {

        currentDownloadUrl = "";

        if (downloadResult) {
            downloadResult.style.display = "none";
        }

        if (downloadBtn) {
            downloadBtn.href = "#";
        }

        if (downloadLinkText) {
            downloadLinkText.value = "";
        }

        if (fileReady) {
            fileReady.textContent = "";
        }

        if (expiryText) {
            expiryText.textContent = "";
        }

        if (copyStatus) {
            copyStatus.textContent = "";
        }

        if (copyBtn) {
            copyBtn.textContent = "Copy Link";
        }
    }


    // =====================================================
    // RESET PROGRESS
    // =====================================================

    function resetProgress() {

        if (progressBar) {
            progressBar.style.width = "0%";
        }

        if (progressText) {
            progressText.textContent = "0%";
        }
    }


    // =====================================================
    // SET STATUS
    // =====================================================

    function setStatus(message) {

        if (status) {
            status.textContent = message;
        }

        console.log(message);
    }


    // =====================================================
    // CREATE FULL DOWNLOAD URL
    // =====================================================

    function createFullDownloadUrl(downloadUrl) {

        if (
            typeof downloadUrl !== "string" ||
            downloadUrl.trim() === ""
        ) {
            return "";
        }

        const url = downloadUrl.trim();

        if (
            url.startsWith("http://") ||
            url.startsWith("https://")
        ) {
            return url;
        }

        if (url.startsWith("/")) {
            return window.location.origin + url;
        }

        return window.location.origin + "/" + url;
    }


    // =====================================================
    // SHOW DOWNLOAD RESULT
    // =====================================================

    function showDownloadLink(response) {

        if (!response || !response.downloadUrl) {

            console.error(
                "No downloadUrl received:",
                response
            );

            setStatus(
                "Upload completed, but no download link was received."
            );

            return;
        }

        const fullUrl =
            createFullDownloadUrl(
                response.downloadUrl
            );

        if (!fullUrl) {

            setStatus(
                "Upload completed, but the download link is invalid."
            );

            return;
        }

        currentDownloadUrl = fullUrl;


        // -------------------------------------------------
        // SHOW DOWNLOAD AREA
        // -------------------------------------------------

        if (downloadResult) {
            downloadResult.style.display = "block";
        }


        // -------------------------------------------------
        // DOWNLOAD BUTTON
        // -------------------------------------------------

        if (downloadBtn) {
            downloadBtn.href = currentDownloadUrl;
        }


        // -------------------------------------------------
        // LINK TEXT
        // -------------------------------------------------

        if (downloadLinkText) {
            downloadLinkText.value = currentDownloadUrl;
        }


        // -------------------------------------------------
        // FILE NAME
        // -------------------------------------------------

        if (fileReady) {

            if (response.fileName) {

                fileReady.textContent =
                    "Your file is ready: " +
                    response.fileName;

            } else {

                fileReady.textContent =
                    "Your file is ready.";
            }
        }


        // -------------------------------------------------
        // EXPIRY
        // -------------------------------------------------

        if (expiryText) {

            if (
                response.deleteMode ===
                "after-download"
            ) {

                expiryText.textContent =
                    "Auto Delete: After Download.";

            } else if (response.deleteAt) {

                const expiryDate =
                    new Date(response.deleteAt);

                if (
                    !Number.isNaN(
                        expiryDate.getTime()
                    )
                ) {

                    expiryText.textContent =
                        "File expires at: " +
                        expiryDate.toLocaleString();

                } else {

                    expiryText.textContent =
                        "The file will be automatically deleted.";
                }

            } else {

                expiryText.textContent =
                    "The file will be automatically deleted.";
            }
        }


        console.log(
            "Download link:",
            currentDownloadUrl
        );
    }


    // =====================================================
    // COPY DOWNLOAD LINK
    // =====================================================

    async function copyDownloadLink() {

        if (!currentDownloadUrl) {

            if (copyStatus) {
                copyStatus.textContent =
                    "No download link available.";
            }

            return;
        }

        try {

            await navigator.clipboard.writeText(
                currentDownloadUrl
            );

            if (copyBtn) {
                copyBtn.textContent =
                    "Link Copied!";
            }

            if (copyStatus) {
                copyStatus.textContent =
                    "Download link copied successfully.";
            }

        } catch (error) {

            console.warn(
                "Clipboard API failed:",
                error
            );

            const tempInput =
                document.createElement("input");

            tempInput.value =
                currentDownloadUrl;

            tempInput.style.position =
                "fixed";

            tempInput.style.left =
                "-9999px";

            document.body.appendChild(
                tempInput
            );

            tempInput.select();

            let copied = false;

            try {

                copied =
                    document.execCommand("copy");

            } catch (copyError) {

                console.error(
                    "Fallback copy failed:",
                    copyError
                );
            }

            tempInput.remove();

            if (copied) {

                if (copyBtn) {
                    copyBtn.textContent =
                        "Link Copied!";
                }

                if (copyStatus) {
                    copyStatus.textContent =
                        "Download link copied successfully.";
                }

            } else {

                if (copyStatus) {
                    copyStatus.textContent =
                        "Copy failed. Please copy the link manually.";
                }
            }
        }

        setTimeout(() => {

            if (copyBtn) {
                copyBtn.textContent =
                    "Copy Link";
            }

        }, 2500);
    }


    // =====================================================
    // COPY BUTTON
    // =====================================================

    if (copyBtn) {

        copyBtn.addEventListener(
            "click",
            copyDownloadLink
        );
    }


    // =====================================================
    // UPLOAD BUTTON
    // =====================================================

    uploadBtn.addEventListener(
        "click",
        () => {

            console.log("Upload button clicked.");


            // -------------------------------------------------
            // CHECK FILE
            // -------------------------------------------------

            if (
                !fileInput.files ||
                fileInput.files.length === 0
            ) {

                alert(
                    "Please choose a file first."
                );

                return;
            }


            const file =
                fileInput.files[0];


            console.log(
                "Selected file:",
                file.name,
                file.size,
                "bytes"
            );


            // -------------------------------------------------
            // RESET UI
            // -------------------------------------------------

            resetDownloadArea();
            resetProgress();


            uploadBtn.disabled =
                true;

            setStatus(
                "Preparing upload..."
            );


            // -------------------------------------------------
            // FORM DATA
            // -------------------------------------------------

            const formData =
                new FormData();

            formData.append(
                "file",
                file
            );

            formData.append(
                "deleteAfter",
                deleteAfter.value
            );


            console.log(
                "Delete option:",
                deleteAfter.value
            );


            // -------------------------------------------------
            // CREATE XHR
            // -------------------------------------------------

            const xhr =
                new XMLHttpRequest();


            xhr.open(
                "POST",
                "/upload",
                true
            );


            xhr.timeout = 0;


            xhr.setRequestHeader(
                "Accept",
                "application/json"
            );


            // -------------------------------------------------
            // UPLOAD PROGRESS
            // -------------------------------------------------

            xhr.upload.addEventListener(
                "progress",
                (event) => {

                    if (!event.lengthComputable) {
                        return;
                    }

                    const percent =
                        Math.round(
                            (
                                event.loaded /
                                event.total
                            ) * 100
                        );


                    if (progressBar) {

                        progressBar.style.width =
                            percent + "%";
                    }


                    if (progressText) {

                        progressText.textContent =
                            percent + "%";
                    }


                    if (percent < 100) {

                        setStatus(
                            "Uploading... " +
                            percent +
                            "%"
                        );

                    } else {

                        setStatus(
                            "File received. Finalizing upload..."
                        );
                    }
                }
            );


            // -------------------------------------------------
            // SUCCESS / SERVER RESPONSE
            // -------------------------------------------------

            xhr.addEventListener(
                "load",
                () => {

                    uploadBtn.disabled =
                        false;


                    console.log(
                        "Server status:",
                        xhr.status
                    );

                    console.log(
                        "Server response:",
                        xhr.responseText
                    );


                    if (
                        xhr.status >= 200 &&
                        xhr.status < 300
                    ) {

                        if (progressBar) {
                            progressBar.style.width =
                                "100%";
                        }

                        if (progressText) {
                            progressText.textContent =
                                "100%";
                        }


                        let response;

                        try {

                            response =
                                JSON.parse(
                                    xhr.responseText
                                );

                        } catch (error) {

                            console.error(
                                "Invalid JSON:",
                                error
                            );

                            setStatus(
                                "Upload completed, but the server returned an invalid response."
                            );

                            return;
                        }


                        console.log(
                            "Parsed response:",
                            response
                        );


                        if (
                            response.success === false
                        ) {

                            setStatus(
                                response.error ||
                                "Upload failed."
                            );

                            return;
                        }


                        setStatus(
                            "Upload complete!"
                        );


                        showDownloadLink(
                            response
                        );


                        if (downloadResult) {

                            setTimeout(() => {

                                downloadResult.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center"
                                });

                            }, 200);
                        }
                    }


                    // -------------------------------------------------
                    // SERVER ERROR
                    // -------------------------------------------------

                    else {

                        let errorMessage =
                            "Upload failed.";

                        try {

                            const errorResponse =
                                JSON.parse(
                                    xhr.responseText
                                );

                            if (
                                errorResponse.error
                            ) {

                                errorMessage =
                                    errorResponse.error;
                            }

                            if (
                                errorResponse.details
                            ) {

                                errorMessage +=
                                    " " +
                                    errorResponse.details;
                            }

                        } catch (error) {

                            console.error(
                                "Error response was not JSON:",
                                error
                            );
                        }


                        setStatus(
                            errorMessage
                        );
                    }
                }
            );


            // -------------------------------------------------
            // NETWORK ERROR
            // -------------------------------------------------

            xhr.addEventListener(
                "error",
                () => {

                    uploadBtn.disabled =
                        false;

                    setStatus(
                        "Upload failed because of a network error."
                    );

                    console.error(
                        "XHR network error."
                    );
                }
            );


            // -------------------------------------------------
            // ABORT
            // -------------------------------------------------

            xhr.addEventListener(
                "abort",
                () => {

                    uploadBtn.disabled =
                        false;

                    setStatus(
                        "Upload was cancelled."
                    );
                }
            );


            // -------------------------------------------------
            // TIMEOUT
            // -------------------------------------------------

            xhr.addEventListener(
                "timeout",
                () => {

                    uploadBtn.disabled =
                        false;

                    setStatus(
                        "Upload timed out. Please try again."
                    );
                }
            );


            // -------------------------------------------------
            // SEND UPLOAD
            // -------------------------------------------------

            console.log(
                "Sending upload request to /upload..."
            );

            xhr.send(
                formData
            );
        }
    );


    // =====================================================
    // FILE SELECTION
    // =====================================================

    fileInput.addEventListener(
        "change",
        () => {

            resetDownloadArea();
            resetProgress();

            if (
                fileInput.files &&
                fileInput.files.length > 0
            ) {

                setStatus(
                    "Ready to upload."
                );

                console.log(
                    "File selected:",
                    fileInput.files[0].name
                );
            }
        }
    );


    // =====================================================
    // INITIAL STATE
    // =====================================================

    resetProgress();

    console.log(
        "FileShare frontend initialized successfully."
    );
});