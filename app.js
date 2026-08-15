"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const fileInput = document.getElementById("fileInput");
    const deleteAfter = document.getElementById("deleteAfter");
    const uploadBtn = document.getElementById("uploadBtn");

    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");
    const status = document.getElementById("status");

    const downloadResult =
        document.getElementById("downloadResult");

    const downloadBtn =
        document.getElementById("downloadBtn");

    const copyBtn =
        document.getElementById("copyBtn");

    const copyStatus =
        document.getElementById("copyStatus");

    const expiryText =
        document.getElementById("expiryText");


    // =====================================================
    // CHECK REQUIRED ELEMENTS
    // =====================================================

    if (
        !fileInput ||
        !deleteAfter ||
        !uploadBtn ||
        !progressBar ||
        !progressText ||
        !status
    ) {

        console.error(
            "FileShare: Required HTML elements are missing."
        );

        return;
    }


    // =====================================================
    // INITIAL STATE
    // =====================================================

    progressBar.style.width = "0%";
    progressText.textContent = "0%";

    uploadBtn.disabled = false;


    // =====================================================
    // UPLOAD BUTTON
    // =====================================================

    uploadBtn.addEventListener(
        "click",
        () => {

            console.log(
                "Upload button clicked."
            );


            const file =
                fileInput.files &&
                fileInput.files[0];


            // -------------------------------------------------
            // NO FILE
            // -------------------------------------------------

            if (!file) {

                status.textContent =
                    "Please choose a file first.";

                alert(
                    "Please choose a file first."
                );

                return;
            }


            console.log(
                "Selected file:",
                file.name
            );

            console.log(
                "File size:",
                file.size,
                "bytes"
            );


            // =================================================
            // RESET UI
            // =================================================

            uploadBtn.disabled = true;

            progressBar.style.width =
                "0%";

            progressText.textContent =
                "0%";

            status.textContent =
                "Uploading...";

            if (downloadResult) {

                downloadResult.style.display =
                    "none";
            }

            if (copyStatus) {

                copyStatus.textContent =
                    "";
            }

            if (expiryText) {

                expiryText.textContent =
                    "";
            }


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
                String(
                    deleteAfter.value
                )
            );


            console.log(
                "Auto delete:",
                deleteAfter.value
            );


            // =================================================
            // XMLHttpRequest
            // =================================================

            const xhr =
                new XMLHttpRequest();


            xhr.open(
                "POST",
                "/upload",
                true
            );


            xhr.responseType =
                "text";


            // =================================================
            // UPLOAD PROGRESS
            // =================================================

            xhr.upload.onprogress =
                (event) => {

                    if (
                        event.lengthComputable
                    ) {

                        const percent =
                            Math.round(
                                (
                                    event.loaded /
                                    event.total
                                ) *
                                100
                            );


                        progressBar.style.width =
                            percent + "%";

                        progressText.textContent =
                            percent + "%";

                        status.textContent =
                            "Uploading...";
                    }
                };


            // =================================================
            // UPLOAD COMPLETE
            // =================================================

            xhr.onload =
                () => {

                    console.log(
                        "Server HTTP status:",
                        xhr.status
                    );

                    console.log(
                        "Server response:",
                        xhr.responseText
                    );


                    uploadBtn.disabled =
                        false;


                    if (
                        xhr.status < 200 ||
                        xhr.status >= 300
                    ) {

                        progressText.textContent =
                            "0%";

                        progressBar.style.width =
                            "0%";

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

                            if (
                                xhr.responseText
                            ) {

                                errorMessage =
                                    xhr.responseText;
                            }
                        }


                        status.textContent =
                            errorMessage;


                        console.error(
                            "Upload failed:",
                            errorMessage
                        );


                        return;
                    }


                    // =================================================
                    // PARSE SERVER RESPONSE
                    // =================================================

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


                        status.textContent =
                            "Upload completed, but server response was invalid.";

                        return;
                    }


                    console.log(
                        "Parsed upload response:",
                        response
                    );


                    if (
                        !response.success
                    ) {

                        status.textContent =
                            response.error ||
                            "Upload failed.";

                        return;
                    }


                    if (
                        !response.downloadUrl
                    ) {

                        console.error(
                            "No downloadUrl returned:",
                            response
                        );


                        status.textContent =
                            "Upload completed, but no download link was returned.";

                        return;
                    }


                    // =================================================
                    // SUCCESS
                    // =================================================

                    progressBar.style.width =
                        "100%";

                    progressText.textContent =
                        "100%";

                    status.textContent =
                        "Upload complete!";


                    // =================================================
                    // CREATE FULL DOWNLOAD URL
                    // =================================================

                    let downloadUrl =
                        response.downloadUrl;


                    if (
                        !downloadUrl.startsWith(
                            "http://"
                        ) &&
                        !downloadUrl.startsWith(
                            "https://"
                        )
                    ) {

                        downloadUrl =
                            window.location.origin +
                            (
                                downloadUrl.startsWith(
                                    "/"
                                )
                                    ? downloadUrl
                                    : "/" + downloadUrl
                            );
                    }


                    console.log(
                        "Final download URL:",
                        downloadUrl
                    );


                    // =================================================
                    // SHOW DOWNLOAD AREA
                    // =================================================

                    if (downloadResult) {

                        downloadResult.style.display =
                            "block";
                    }


                    // =================================================
                    // DOWNLOAD BUTTON
                    // =================================================

                    if (downloadBtn) {

                        downloadBtn.href =
                            downloadUrl;

                        downloadBtn.target =
                            "_blank";

                        downloadBtn.rel =
                            "noopener noreferrer";
                    }


                    // =================================================
                    // EXPIRY INFORMATION
                    // =================================================

                    if (
                        expiryText &&
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
                                "File expires: " +
                                expiryDate.toLocaleString();
                        }
                    }


                    // =================================================
                    // COPY LINK
                    // =================================================

                    if (copyBtn) {

                        copyBtn.textContent =
                            "Copy Link";
                    }


                    if (copyStatus) {

                        copyStatus.textContent =
                            "";
                    }


                    if (copyBtn) {

                        copyBtn.onclick =
                            async () => {

                                try {

                                    await navigator.clipboard.writeText(
                                        downloadUrl
                                    );


                                    copyBtn.textContent =
                                        "Link Copied!";


                                    if (copyStatus) {

                                        copyStatus.textContent =
                                            "Download link copied successfully.";
                                    }


                                } catch (error) {

                                    console.warn(
                                        "Clipboard API failed:",
                                        error
                                    );


                                    // ---------------------------------
                                    // FALLBACK
                                    // ---------------------------------

                                    try {

                                        const input =
                                            document.createElement(
                                                "input"
                                            );


                                        input.value =
                                            downloadUrl;


                                        input.style.position =
                                            "fixed";

                                        input.style.left =
                                            "-9999px";


                                        document.body.appendChild(
                                            input
                                        );


                                        input.focus();

                                        input.select();


                                        document.execCommand(
                                            "copy"
                                        );


                                        input.remove();


                                        copyBtn.textContent =
                                            "Link Copied!";


                                        if (copyStatus) {

                                            copyStatus.textContent =
                                                "Download link copied successfully.";
                                        }


                                    } catch (fallbackError) {

                                        console.error(
                                            "Copy failed:",
                                            fallbackError
                                        );


                                        if (copyStatus) {

                                            copyStatus.textContent =
                                                "Copy failed. Please copy the link manually.";
                                        }
                                    }
                                }


                                setTimeout(
                                    () => {

                                        copyBtn.textContent =
                                            "Copy Link";

                                        if (copyStatus) {

                                            copyStatus.textContent =
                                                "";
                                        }

                                    },
                                    2500
                                );
                            };
                    }
                };


            // =================================================
            // NETWORK ERROR
            // =================================================

            xhr.onerror =
                () => {

                    console.error(
                        "Network error while uploading."
                    );


                    uploadBtn.disabled =
                        false;


                    status.textContent =
                        "Upload failed. Please check your internet connection.";
                };


            // =================================================
            // TIMEOUT
            // =================================================

            xhr.ontimeout =
                () => {

                    console.error(
                        "Upload request timed out."
                    );


                    uploadBtn.disabled =
                        false;


                    status.textContent =
                        "Upload timed out. Please try again.";
                };


            // =================================================
            // ABORT
            // =================================================

            xhr.onabort =
                () => {

                    console.warn(
                        "Upload was aborted."
                    );


                    uploadBtn.disabled =
                        false;


                    status.textContent =
                        "Upload cancelled.";
                };


            // =================================================
            // SEND
            // =================================================

            console.log(
                "Sending POST /upload..."
            );


            xhr.send(
                formData
            );
        }
    );

});