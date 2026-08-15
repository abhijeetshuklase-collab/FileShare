const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const status = document.getElementById("status");

const deleteAfter = document.getElementById("deleteAfter");

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


uploadBtn.addEventListener("click", () => {

    const file = fileInput.files[0];

    if (!file) {
        alert("Please choose a file first.");
        return;
    }

    uploadBtn.disabled = true;

    progressBar.style.width = "0%";
    progressText.textContent = "0%";
    status.textContent = "Uploading...";

    downloadResult.style.display = "none";
    copyStatus.textContent = "";

    const formData = new FormData();

    formData.append("file", file);

    // Send Auto Delete selection
    formData.append(
        "deleteAfter",
        deleteAfter.value
    );

    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/upload", true);


    // =====================================================
    // UPLOAD PROGRESS
    // =====================================================

    xhr.upload.onprogress = (event) => {

        if (event.lengthComputable) {

            const percent = Math.round(
                (event.loaded / event.total) * 100
            );

            progressBar.style.width =
                percent + "%";

            progressText.textContent =
                percent + "%";

            status.textContent =
                "Uploading...";
        }
    };


    // =====================================================
    // SERVER RESPONSE
    // =====================================================

    xhr.onload = () => {

        uploadBtn.disabled = false;

        if (
            xhr.status >= 200 &&
            xhr.status < 300
        ) {

            progressBar.style.width = "100%";
            progressText.textContent = "100%";
            status.textContent = "Upload complete!";

            try {

                const response =
                    JSON.parse(xhr.responseText);

                console.log(
                    "Upload response:",
                    response
                );


                if (!response.downloadUrl) {

                    status.textContent =
                        "Upload complete, but download link was not returned.";

                    console.error(
                        "No download URL:",
                        response
                    );

                    return;
                }


                let downloadUrl =
                    response.downloadUrl;


                if (
                    !downloadUrl.startsWith("http://") &&
                    !downloadUrl.startsWith("https://")
                ) {

                    downloadUrl =
                        window.location.origin +
                        downloadUrl;
                }


                // =================================================
                // SHOW DOWNLOAD AREA
                // =================================================

                downloadResult.style.display =
                    "block";

                downloadBtn.href =
                    downloadUrl;


                // =================================================
                // AUTO DELETE MESSAGE
                // =================================================

                if (
                    response.deleteMode ===
                    "after-download"
                ) {

                    expiryText.textContent =
                        "🗑️ File will be deleted after the first download.";

                } else if (response.deleteAt) {

                    const deleteDate =
                        new Date(
                            response.deleteAt
                        );

                    expiryText.textContent =
                        "🗑️ File will be automatically deleted on " +
                        deleteDate.toLocaleString();
                }


                // =================================================
                // COPY LINK
                // =================================================

                copyBtn.textContent =
                    "Copy Link";

                copyStatus.textContent =
                    "";


                copyBtn.onclick = async () => {

                    try {

                        await navigator.clipboard.writeText(
                            downloadUrl
                        );

                        copyBtn.textContent =
                            "Link Copied!";

                        copyStatus.textContent =
                            "Download link copied successfully.";

                        setTimeout(() => {

                            copyBtn.textContent =
                                "Copy Link";

                            copyStatus.textContent =
                                "";

                        }, 2000);

                    } catch (error) {

                        console.error(
                            "Clipboard error:",
                            error
                        );


                        const temporaryInput =
                            document.createElement(
                                "input"
                            );

                        temporaryInput.value =
                            downloadUrl;

                        document.body.appendChild(
                            temporaryInput
                        );

                        temporaryInput.select();

                        document.execCommand(
                            "copy"
                        );

                        temporaryInput.remove();

                        copyBtn.textContent =
                            "Link Copied!";

                        copyStatus.textContent =
                            "Download link copied successfully.";

                        setTimeout(() => {

                            copyBtn.textContent =
                                "Copy Link";

                            copyStatus.textContent =
                                "";

                        }, 2000);
                    }
                };


                console.log(
                    "Download link:",
                    downloadUrl
                );

            } catch (error) {

                console.error(
                    "Response parsing error:",
                    error
                );

                status.textContent =
                    "Upload completed, but server response was invalid.";
            }

        } else {

            status.textContent =
                "Upload failed.";

            console.error(
                "Server response:",
                xhr.responseText
            );

            alert(
                "Upload failed. Check the server console."
            );
        }
    };


    // =====================================================
    // CONNECTION ERROR
    // =====================================================

    xhr.onerror = () => {

        uploadBtn.disabled = false;

        status.textContent =
            "Upload failed.";

        alert(
            "Upload failed. Check your connection."
        );
    };


    // =====================================================
    // SEND
    // =====================================================

    xhr.send(formData);

});