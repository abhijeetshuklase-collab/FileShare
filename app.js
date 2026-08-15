const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const status = document.getElementById("status");

const downloadResult = document.getElementById("downloadResult");
const downloadBtn = document.getElementById("downloadBtn");
const copyBtn = document.getElementById("copyBtn");
const copyStatus = document.getElementById("copyStatus");


uploadBtn.addEventListener("click", () => {

    const file = fileInput.files[0];

    if (!file) {
        alert("Please choose a file first.");
        return;
    }

    // Reset UI
    uploadBtn.disabled = true;

    progressBar.style.width = "0%";
    progressText.textContent = "0%";
    status.textContent = "Uploading...";

    downloadResult.style.display = "none";
    copyStatus.textContent = "";

    // Create FormData
    const formData = new FormData();
    formData.append("file", file);

    // Create request
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

            progressBar.style.width = percent + "%";
            progressText.textContent = percent + "%";
            status.textContent = "Uploading...";
        }
    };


    // =====================================================
    // SERVER RESPONSE
    // =====================================================

    xhr.onload = () => {

        uploadBtn.disabled = false;

        if (xhr.status >= 200 && xhr.status < 300) {

            progressBar.style.width = "100%";
            progressText.textContent = "100%";
            status.textContent = "Upload complete!";

            try {

                const response = JSON.parse(xhr.responseText);

                console.log("Upload response:", response);


                // =================================================
                // CHECK DOWNLOAD URL
                // =================================================

                if (!response.downloadUrl) {

                    console.error(
                        "Server did not return downloadUrl:",
                        response
                    );

                    status.textContent =
                        "Upload complete, but download link was not returned.";

                    return;
                }


                // =================================================
                // SET DOWNLOAD LINK
                // =================================================

                let downloadUrl = response.downloadUrl;

                /*
                 * If the server returns a relative URL such as:
                 *
                 * /download/abc
                 *
                 * convert it into:
                 *
                 * http://localhost:3000/download/abc
                 *
                 * If it is already a full URL, leave it unchanged.
                 */

                if (!downloadUrl.startsWith("http://") &&
                    !downloadUrl.startsWith("https://")) {

                    downloadUrl =
                        window.location.origin +
                        downloadUrl;
                }


                // =================================================
                // SHOW DOWNLOAD AREA
                // =================================================

                downloadResult.style.display = "block";


                // =================================================
                // DOWNLOAD BUTTON
                // =================================================

                downloadBtn.href = downloadUrl;


                // =================================================
                // COPY LINK BUTTON
                // =================================================

                copyBtn.textContent = "Copy Link";

                copyStatus.textContent = "";


                copyBtn.onclick = async () => {

                    try {

                        await navigator.clipboard.writeText(
                            downloadUrl
                        );

                        copyBtn.textContent = "Link Copied!";

                        copyStatus.textContent =
                            "Download link copied successfully.";

                        setTimeout(() => {

                            copyBtn.textContent = "Copy Link";

                            copyStatus.textContent = "";

                        }, 2000);

                    } catch (error) {

                        console.error(
                            "Clipboard error:",
                            error
                        );

                        // Fallback
                        const temporaryInput =
                            document.createElement("input");

                        temporaryInput.value = downloadUrl;

                        document.body.appendChild(
                            temporaryInput
                        );

                        temporaryInput.select();

                        document.execCommand("copy");

                        temporaryInput.remove();

                        copyBtn.textContent = "Link Copied!";

                        copyStatus.textContent =
                            "Download link copied successfully.";

                        setTimeout(() => {

                            copyBtn.textContent = "Copy Link";

                            copyStatus.textContent = "";

                        }, 2000);
                    }
                };


                // =================================================
                // SUCCESS
                // =================================================

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

            status.textContent = "Upload failed.";

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
    // SEND FILE
    // =====================================================

    xhr.send(formData);
});