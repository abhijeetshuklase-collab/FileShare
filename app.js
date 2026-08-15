"use strict";

document.addEventListener("DOMContentLoaded", () => {

    // =====================================================
    // ELEMENTS
    // =====================================================

    const fileInput =
        document.getElementById("fileInput");

    const deleteAfter =
        document.getElementById("deleteAfter");

    const uploadBtn =
        document.getElementById("uploadBtn");

    const progressBar =
        document.getElementById("progressBar");

    const progressText =
        document.getElementById("progressText");

    const status =
        document.getElementById("status");

    const downloadResult =
        document.getElementById("downloadResult");

    const downloadBtn =
        document.getElementById("downloadBtn");

    const copyBtn =
        document.getElementById("copyBtn");

    const copyStatus =
        document.getElementById("copyStatus");

    const downloadLinkText =
        document.getElementById("downloadLinkText");

    const fileReady =
        document.getElementById("fileReady");

    const expiryText =
        document.getElementById("expiryText");


    // =====================================================
    // CHECK ELEMENTS
    // =====================================================

    const requiredElements = [
        fileInput,
        deleteAfter,
        uploadBtn,
        progressBar,
        progressText,
        status,
        downloadResult,
        downloadBtn,
        copyBtn,
        copyStatus,
        downloadLinkText,
        fileReady,
        expiryText
    ];

    if (
        requiredElements.some(
            element => !element
        )
    ) {
        console.error(
            "FileShare: Required HTML element is missing."
        );

        return;
    }


    // =====================================================
    // VARIABLES
    // =====================================================

    let currentDownloadUrl = "";


    // =====================================================
    // RESET DOWNLOAD AREA
    // =====================================================

    function resetDownloadArea() {

        currentDownloadUrl = "";

        downloadResult.style.display = "none";

        downloadBtn.href = "#";

        downloadLinkText.value = "";

        fileReady.textContent = "";

        expiryText.textContent = "";

        copyStatus.textContent = "";

        copyBtn.textContent = "Copy Link";
    }


    // =====================================================
    // RESET PROGRESS
    // =====================================================

    function resetProgress() {

        progressBar.style.width = "0%";

        progressText.textContent = "0%";

        status.textContent = "";
    }


    // =====================================================
    // CREATE FULL DOWNLOAD URL
    // =====================================================

    function createFullDownloadUrl(
        downloadUrl
    ) {

        if (
            typeof downloadUrl !== "string" ||
            downloadUrl.trim() === ""
        ) {
            return "";
        }

        const trimmedUrl =
            downloadUrl.trim();


        if (
            trimmedUrl.startsWith("http://") ||
            trimmedUrl.startsWith("https://")
        ) {
            return trimmedUrl;
        }


        if (
            trimmedUrl.startsWith("/")
        ) {
            return (
                window.location.origin +
                trimmedUrl
            );
        }


        return (
            window.location.origin +
            "/" +
            trimmedUrl
        );
    }


    // =====================================================
    // DISPLAY DOWNLOAD LINK
    // =====================================================

    function showDownloadLink(response) {

        if (
            !response ||
            !response.downloadUrl
        ) {

            console.error(
                "Server response does not contain downloadUrl:",
                response
            );

            status.textContent =
                "Upload completed, but the download link was not received.";

            return false;
        }


        const fullUrl =
            createFullDownloadUrl(
                response.downloadUrl
            );


        if (!fullUrl) {

            status.textContent =
                "Upload completed, but the download link is invalid.";

            return false;
        }


        currentDownloadUrl =
            fullUrl;


        // Show result
        downloadResult.style.display =
            "block";


        // Download button
        downloadBtn.href =
            currentDownloadUrl;


        // Link box
        downloadLinkText.value =
            currentDownloadUrl;


        // File name
        if (response.fileName) {

            fileReady.textContent =
                "Your file is ready: " +
                response.fileName;

        } else {

            fileReady.textContent =
                "Your file is ready.";
        }


        // Expiry information
        if (
            response.deleteMode ===
            "after-download"
        ) {

            expiryText.textContent =
                "Auto Delete: After Download " +
                "(maximum 30 minutes if nobody downloads it).";

        } else if (
            response.deleteAt
        ) {

            const expiryDate =
                new Date(
                    response.deleteAt
                );


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


        copyBtn.textContent =
            "Copy Link";

        copyStatus.textContent =
            "";


        console.log(
            "Download URL:",
            currentDownloadUrl
        );


        return true;
    }


    // =====================================================
    // COPY LINK
    // =====================================================

    async function copyDownloadLink() {

        if (!currentDownloadUrl) {

            copyStatus.textContent =
                "No download link available.";

            return;
        }


        try {

            if (
                navigator.clipboard &&
                navigator.clipboard.writeText
            ) {

                await navigator.clipboard.writeText(
                    currentDownloadUrl
                );

            } else {

                throw new Error(
                    "Clipboard API unavailable"
                );
            }


            copyBtn.textContent =
                "Link Copied!";

            copyStatus.textContent =
                "Download link copied successfully.";

        } catch (error) {

            console.warn(
                "Clipboard API failed:",
                error
            );


            const temporaryInput =
                document.createElement("input");

            temporaryInput.type =
                "text";

            temporaryInput.value =
                currentDownloadUrl;

            temporaryInput.style.position =
                "fixed";

            temporaryInput.style.left =
                "-9999px";

            document.body.appendChild(
                temporaryInput
            );

            temporaryInput.focus();

            temporaryInput.select();


            let copied = false;


            try {

                copied =
                    document.execCommand(
                        "copy"
                    );

            } catch (fallbackError) {

                console.error(
                    "Copy fallback failed:",
                    fallbackError
                );
            }


            temporaryInput.remove();


            if (copied) {

                copyBtn.textContent =
                    "Link Copied!";

                copyStatus.textContent =
                    "Download link copied successfully.";

            } else {

                copyStatus.textContent =
                    "Copy failed. Please copy the link manually.";
            }
        }


        setTimeout(() => {

            copyBtn.textContent =
                "Copy Link";

        }, 2500);
    }


    copyBtn.addEventListener(
        "click",
        copyDownloadLink
    );


    // =====================================================
    // UPLOAD
    // =====================================================

    uploadBtn.addEventListener(
        "click",
        () => {

            const file =
                fileInput.files[0];


            // No file
            if (!file) {

                alert(
                    "Please choose a file first."
                );

                return;
            }


            // Reset
            resetDownloadArea();

            resetProgress();


            uploadBtn.disabled =
                true;

            uploadBtn.textContent =
                "Uploading...";

            status.textContent =
                "Preparing upload...";


            // =================================================
            // FORM DATA
            // =================================================

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


            // =================================================
            // XHR
            // =================================================

            const xhr =
                new XMLHttpRequest();


            xhr.open(
                "POST",
                "/upload",
                true
            );


            /*
             * No timeout.
             *
             * This is important for large files.
             */

            xhr.timeout = 0;


            xhr.setRequestHeader(
                "Accept",
                "application/json"
            );


            // =================================================
            // PROGRESS
            // =================================================

            xhr.upload.addEventListener(
                "progress",
                event => {

                    if (
                        event.lengthComputable
                    ) {

                        const percent =
                            Math.round(
                                (
                                    event.loaded /
                                    event.total
                                ) * 100
                            );


                        progressBar.style.width =
                            percent + "%";


                        progressText.textContent =
                            percent + "%";


                        if (
                            percent < 100
                        ) {

                            status.textContent =
                                "Uploading... " +
                                percent +
                                "%";

                        } else {

                            status.textContent =
                                "File received. Finalizing upload...";
                        }
                    }
                }
            );


            // =================================================
            // COMPLETE RESPONSE
            // =================================================

            xhr.addEventListener(
                "load",
                () => {

                    uploadBtn.disabled =
                        false;

                    uploadBtn.textContent =
                        "Upload File";


                    if (
                        xhr.status >= 200 &&
                        xhr.status < 300
                    ) {

                        progressBar.style.width =
                            "100%";

                        progressText.textContent =
                            "100%";


                        let response;


                        try {

                            response =
                                JSON.parse(
                                    xhr.responseText
                                );

                        } catch (error) {

                            console.error(
                                "Invalid JSON response:",
                                error
                            );

                            console.error(
                                "Server response:",
                                xhr.responseText
                            );

                            status.textContent =
                                "Upload completed, but the server response was invalid.";

                            return;
                        }


                        console.log(
                            "Upload response:",
                            response
                        );


                        if (
                            response.success === false
                        ) {

                            status.textContent =
                                response.error ||
                                "Upload failed.";

                            return;
                        }


                        status.textContent =
                            "Upload complete!";


                        const displayed =
                            showDownloadLink(
                                response
                            );


                        if (!displayed) {
                            return;
                        }


                        setTimeout(() => {

                            downloadResult.scrollIntoView({
                                behavior: "smooth",
                                block: "center"
                            });

                        }, 100);

                    } else {

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
                                "Error response could not be parsed:",
                                error
                            );
                        }


                        status.textContent =
                            errorMessage;


                        console.error(
                            "Server error:",
                            xhr.status,
                            xhr.responseText
                        );
                    }
                }
            );


            // =================================================
            // NETWORK ERROR
            // =================================================

            xhr.addEventListener(
                "error",
                () => {

                    uploadBtn.disabled =
                        false;

                    uploadBtn.textContent =
                        "Upload File";

                    status.textContent =
                        "Upload failed because of a network error.";

                }
            );


            // =================================================
            // ABORT
            // =================================================

            xhr.addEventListener(
                "abort",
                () => {

                    uploadBtn.disabled =
                        false;

                    uploadBtn.textContent =
                        "Upload File";

                    status.textContent =
                        "Upload was cancelled.";

                }
            );


            // =================================================
            // TIMEOUT
            // =================================================

            xhr.addEventListener(
                "timeout",
                () => {

                    uploadBtn.disabled =
                        false;

                    uploadBtn.textContent =
                        "Upload File";

                    status.textContent =
                        "Upload timed out. Please try again.";

                }
            );


            console.log(
                "Starting upload:",
                file.name,
                file.size,
                "bytes"
            );

            console.log(
                "Auto Delete:",
                deleteAfter.value
            );


            // START
            xhr.send(
                formData
            );
        }
    );


    // =====================================================
    // FILE CHANGE
    // =====================================================

    fileInput.addEventListener(
        "change",
        () => {

            resetDownloadArea();

            resetProgress();


            if (
                fileInput.files.length > 0
            ) {

                status.textContent =
                    "Ready to upload.";
            }
        }
    );

});