const fileInput = document.getElementById('file-input');
const pdfContainer = document.getElementById('pdf-container');
const saveBtn = document.getElementById('save-btn');
const splitBtn = document.getElementById('split-btn');
const imageToPdfBtn = document.getElementById('image-to-pdf-btn');
const pdfToImageBtn = document.getElementById('pdf-to-image-btn');
const rotateBtn = document.getElementById('rotate-page-btn');
const rearrangePagesBtn = document.getElementById('rearrange-pages-btn');
const watermarkBtn = document.getElementById('watermark-btn');
const compressBtn = document.getElementById('compress-btn');
const mergePdfBtn = document.getElementById('merge-pdf-btn');

const watermarkProperties = {
    fontSize: 50,
    color: 'rgba(0.75, 0.75, 0.75, 0.2)',
    rotationAngleDegrees: 45,
};

let pdfDoc = null;
let pdfBytes = null;
let deletedPages = new Set(); // Track deleted pages
let rotations = {}; // Track rotation of each page
let pageOrder = []; // New variable to track the current order of pages
let watermarkText = ''; // Variable to store the watermark text
let redactMode = false;
let redactBoxes = {}; // { pageIndex: [ {x, y, width, height} ] }

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

let pdfJsDoc = null;

// Update the page counter
function updatePageCounter() {
    const pageCount = pdfDoc.getPageCount() - deletedPages.size;
    document.getElementById('page-counter').innerText = `Pages: ${pageCount}`;
}

// Handle PDF file input
fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        // Reset state variables for new file load
        watermarkText = '';        // Reset watermark text
        rotations = {};            // Reset rotations
        deletedPages.clear();      // Reset deleted pages
        pdfDoc = null;             // Clear the previous PDF document
        pdfJsDoc = null;           // Clear the PDF.js document

        // Load the new file
        const arrayBuffer = await file.arrayBuffer();
        pdfBytes = new Uint8Array(arrayBuffer);

        // Load the PDF using PDF-lib for editing
        pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);

        // Initialize page order for new document
        pageOrder = Array.from({ length: pdfDoc.getPageCount() }, (_, i) => i);

        // Load and render the PDF using PDF.js for viewing
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
        pdfJsDoc = await loadingTask.promise;
        renderPDF();

        // Update page counter for the new document
        updatePageCounter();
    }
});


// Update the renderPDF function to account for the current page order
async function renderPDF() {
    // Show the loading screen with a custom message
    showLoadingScreen('Rendering PDF...');

    // Clear the PDF container to remove any previous content
    pdfContainer.innerHTML = '';

    const pageCount = pdfDoc.getPageCount();
    const newPageOrder = Array.from({ length: pageCount }, (_, i) => i); // Array of page indices

    for (let i = 0; i < newPageOrder.length; i++) {
        const pageIndex = newPageOrder[i]; // Current page index in the new order

        if (deletedPages.has(pageIndex)) continue; // Skip deleted pages

        const page = await pdfJsDoc.getPage(pageIndex + 1); // Load the page using PDF.js
        const rotation = rotations[pageIndex] || 0; // Get rotation angle, default to 0
        const viewport = page.getViewport({ scale: 1.5, rotation }); // Adjust scale and rotation

        // Create a container for the page and delete button
        const pageContainer = document.createElement('div');
        pageContainer.classList.add('page-container');

        // Create canvas to render the page
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });

        // Render the page into the canvas
        const renderContext = { canvasContext: context, viewport: viewport };
        await page.render(renderContext).promise;

        // Apply watermark if specified
        if (watermarkText) {
            drawWatermark(context, watermarkText, viewport.width, viewport.height);
        }

        // Create delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete Page';
        deleteBtn.onclick = () => deletePage(pageIndex);

        // Append canvas and delete button to the page container
        pageContainer.appendChild(canvas);
        pageContainer.appendChild(deleteBtn);
        pdfContainer.appendChild(pageContainer);

        // Update progress on the loading screen
        const progress = Math.round(((i + 1) / pageCount) * 100);
        updateProgress(progress);

        canvas.addEventListener('mousedown', (e) => {
            if (!redactMode) return;

            const rect = canvas.getBoundingClientRect();
            const startX = e.clientX - rect.left;
            const startY = e.clientY - rect.top;

            const box = document.createElement('div');
            box.className = 'redact-box';
            box.style.left = `${startX}px`;
            box.style.top = `${startY}px`;
            box.style.width = `0px`;
            box.style.height = `0px`;
            box.style.position = 'absolute';

            let isDrawing = true;

            canvas.parentElement.appendChild(box);

            function onMouseMove(ev) {
                if (!isDrawing) return;
                const currentX = ev.clientX - rect.left;
                const currentY = ev.clientY - rect.top;
                box.style.width = `${Math.abs(currentX - startX)}px`;
                box.style.height = `${Math.abs(currentY - startY)}px`;
                box.style.left = `${Math.min(currentX, startX)}px`;
                box.style.top = `${Math.min(currentY, startY)}px`;
            }

            function onMouseUp() {
                isDrawing = false;
                const pageIndex = i;
                const boxData = {
                    x: parseFloat(box.style.left),
                    y: parseFloat(box.style.top),
                    width: parseFloat(box.style.width),
                    height: parseFloat(box.style.height),
                };
                if (!redactBoxes[pageIndex]) redactBoxes[pageIndex] = [];
                redactBoxes[pageIndex].push(boxData);

                canvas.removeEventListener('mousemove', onMouseMove);
                canvas.removeEventListener('mouseup', onMouseUp);
            }

            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
        });

    }

    // Hide the loading screen once rendering is complete
    hideLoadingScreen();

    // Display the save button after rendering
    saveBtn.style.display = 'block';
}


// Mark page as deleted and re-render PDF
function deletePage(pageIndex) {
    deletedPages.add(pageIndex); // Mark page for deletion
    renderPDF(); // Re-render without the deleted page
    updatePageCounter(); // Update the page counter after rendering
}

document.getElementById('redact-btn').addEventListener('click', () => {
    redactMode = !redactMode;
    alert(redactMode ? 'Redact mode enabled. Draw boxes on pages.' : 'Redact mode disabled.');
});

// Save the modified PDF using PDF-lib with compression
saveBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;

    // Log all rotation values for debugging
    console.log('Rotation values before saving:', rotations);

    // Create a new PDF document for saving (with compression)
    const newPdfDoc = await PDFLib.PDFDocument.create();

    const pageCount = pdfDoc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
        if (deletedPages.has(i)) continue; // Skip deleted pages

        const [newPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
        newPdfDoc.addPage(newPage); // Add the copied page

        if (redactBoxes[i]) {
            redactBoxes[i].forEach(box => {
                newPage.drawRectangle({
                    x: box.x,
                    y: newPage.getHeight() - box.y - box.height,
                    width: box.width,
                    height: box.height,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
        }


        // Apply the rotation if it exists for the page
        if (rotations[i] !== undefined) {
            newPage.setRotation(PDFLib.degrees(rotations[i])); // Apply the rotation to the copied page
        }

        // Add the watermark to the new page with consistent properties
        if (watermarkText) {
            drawWatermark(newPage, watermarkText, newPage.getWidth(), newPage.getHeight(), false);
        }
    }

    // Serialize the modified and compressed PDF to bytes
    try {
        const compressedPdfBytes = await newPdfDoc.save({
            useObjectStreams: false // This reduces the file size for compression
        });
        downloadPdf(compressedPdfBytes, 'edited.pdf'); // Download the compressed PDF
    } catch (error) {
        console.error('Error saving PDF:', error); // Log any errors encountered during saving
    }
});

// Helper function to download the PDF
function downloadPdf(modifiedPdfBytes, filename) {
    console.log('Preparing PDF for download...');
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log(`PDF downloaded as ${filename}.`);
}


// Split PDF functionality
splitBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;

    const totalPages = pdfDoc.getPageCount();
    const startPage = parseInt(prompt(`Enter start page (1-${totalPages}):`));
    const endPage = parseInt(prompt(`Enter end page (1-${totalPages}):`));

    if (startPage && endPage && startPage <= endPage && startPage >= 1 && endPage <= totalPages) {
        const splitPdf = await PDFLib.PDFDocument.create();
        const pagesToCopy = pdfDoc.getPages().slice(startPage - 1, endPage); // Slice to get the pages

        for (const page of pagesToCopy) {
            const [copiedPage] = await splitPdf.copyPages(pdfDoc, [pdfDoc.getPages().indexOf(page)]);
            splitPdf.addPage(copiedPage);
        }

        const splitPdfBytes = await splitPdf.save();
        downloadPdf(splitPdfBytes, `split_${startPage}-${endPage}.pdf`);
    } else {
        alert('Invalid page range.');
    }
});

// Image to PDF functionality
imageToPdfBtn.addEventListener('click', async () => {
    const imageFileInput = document.createElement('input');
    imageFileInput.type = 'file';
    imageFileInput.accept = 'image/*';
    imageFileInput.multiple = true;

    imageFileInput.onchange = async (event) => {
        const files = event.target.files;
        if (files.length) {
            const imagePdfs = await Promise.all(Array.from(files).map(async (file) => {
                const imageBytes = await file.arrayBuffer();
                const imagePdf = await PDFLib.PDFDocument.create();
                const page = imagePdf.addPage([600, 800]); // Add a page with specified size
                const jpgImage = await imagePdf.embedJpg(imageBytes);
                const { width, height } = jpgImage.scale(1);
                page.drawImage(jpgImage, { x: 0, y: 0, width, height });

                return imagePdf.save();
            }));

            const combinedPdf = await PDFLib.PDFDocument.create();
            for (const imagePdfBytes of imagePdfs) {
                const imagePdf = await PDFLib.PDFDocument.load(imagePdfBytes);
                const pages = await combinedPdf.copyPages(imagePdf, imagePdf.getPageIndices());
                pages.forEach((page) => combinedPdf.addPage(page));
            }

            const combinedPdfBytes = await combinedPdf.save();
            downloadPdf(combinedPdfBytes, 'images_to_pdf.pdf');
        }
    };

    imageFileInput.click();
});

// PDF to image functionality
pdfToImageBtn.addEventListener('click', async () => {
    if (!pdfJsDoc) return;

    const pageCount = pdfJsDoc.numPages;
    for (let i = 1; i <= pageCount; i++) {
        const page = await pdfJsDoc.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d', { willReadFrequently: true });
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };
        await page.render(renderContext).promise;

        const imageUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `page_${i}.png`;
        link.click();
    }
});

// Rotate pages functionality (updated to handle multiple pages)
rotateBtn.addEventListener('click', () => {
    const pageInput = prompt('Enter page numbers to rotate (e.g., 1,2,5 or "all" for all pages):').toLowerCase();
    const rotation = parseInt(prompt('Enter rotation angle (0, 90, 180, 270):'));

    if (![0, 90, 180, 270].includes(rotation)) {
        alert('Invalid rotation angle. Please enter 0, 90, 180, or 270.');
        return;
    }

    let pagesToRotate = [];

    if (pageInput === 'all') {
        // Rotate all pages
        pagesToRotate = Array.from({ length: pdfDoc.getPageCount() }, (_, i) => i);
    } else {
        // Rotate specified pages
        pagesToRotate = pageInput.split(',')
            .map(pageStr => parseInt(pageStr.trim()) - 1)
            .filter(pageIndex => !isNaN(pageIndex) && pageIndex >= 0 && pageIndex < pdfDoc.getPageCount());
    }

    if (pagesToRotate.length === 0) {
        alert('No valid pages selected for rotation.');
        return;
    }

    // Store rotation for each specified page and re-render
    pagesToRotate.forEach(pageIndex => {
        if (rotations[pageIndex] === undefined) {
            rotations[pageIndex] = 0; // Default to no rotation if not already set
        }
        rotations[pageIndex] = (rotations[pageIndex] + rotation) % 360; // Apply the new rotation
    });

    renderPDF(); // Re-render the PDF to apply the rotation
});

// Rearrange pages functionality
rearrangePagesBtn.addEventListener('click', () => {
    const newOrder = prompt('Enter new page order as comma-separated values (e.g., 3,1,2):');
    const orderArray = newOrder.split(',').map(Number).filter(num => !isNaN(num) && num > 0);

    if (orderArray.length === pdfDoc.getPageCount() && new Set(orderArray).size === orderArray.length) {
        pageOrder = orderArray.map(num => num - 1); // Convert to zero-based indexing
        renderPDF(); // Re-render with new page order
    } else {
        alert('Invalid page order. Ensure all page numbers are unique and within range.');
    }
});

// Watermark functionality
watermarkBtn.addEventListener('click', () => {
    const text = prompt('Enter watermark text:');
    if (text) {
        watermarkText = text; // Set the watermark text dynamically
        renderPDF(); // Re-render to apply the watermark
    }
});

function drawWatermark(context, text, width, height, isCanvas = true) {
    const watermarkAngleRadians = (Math.PI / 180) * watermarkProperties.rotationAngleDegrees; // Convert degrees to radians for canvas

    if (isCanvas) {
        // Handle rendering watermark on HTML canvas
        context.font = `${watermarkProperties.fontSize}px Arial`; // Set font size and type
        context.fillStyle = watermarkProperties.color; // Set transparent watermark color
        context.textAlign = 'center'; // Center the text
        context.textBaseline = 'middle'; // Align text to middle baseline
        context.save(); // Save the current context state

        // Translate to the center of the canvas to rotate around the center
        context.translate(width / 2, height / 2);
        context.rotate(watermarkAngleRadians); // Rotate by specified degrees converted to radians

        // Draw the watermark text at the center of the canvas
        context.fillText(text, 0, 0);

        context.restore(); // Restore the context to its original state
    } else {
        // Handle rendering watermark on PDF-lib page
        context.drawText(text, {
            x: width / 2,
            y: height / 2,
            size: watermarkProperties.fontSize,
            color: PDFLib.rgb(0.75, 0.75, 0.75),
            opacity: 0.2,
            rotate: PDFLib.degrees(watermarkProperties.rotationAngleDegrees), // Use the same degree value for PDF-lib
            anchor: 'middle-center', // Center the watermark
        });
    }
}

mergePdfBtn.addEventListener('click', async () => {
    if (!pdfDoc) {
        alert('Please select the first PDF file before merging.');
        return;
    }

    // Prompt the user to select the second PDF
    const secondFileInput = document.createElement('input');
    secondFileInput.type = 'file';
    secondFileInput.accept = 'application/pdf';
    secondFileInput.onchange = async (event) => {
        const secondFile = event.target.files[0];
        if (!secondFile) return;

        const secondArrayBuffer = await secondFile.arrayBuffer();
        const secondPdfDoc = await PDFLib.PDFDocument.load(new Uint8Array(secondArrayBuffer));

        // Copy pages from the second PDF into the first
        const secondPdfPages = await pdfDoc.copyPages(
            secondPdfDoc,
            secondPdfDoc.getPageIndices()
        );
        secondPdfPages.forEach((page) => pdfDoc.addPage(page));

        // Update the rendering and page counter
        pdfBytes = await pdfDoc.save();
        pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        renderPDF();
        updatePageCounter();

        alert('PDFs have been merged successfully!');
    };

    secondFileInput.click();
});

compressBtn.addEventListener('click', async () => {
    if (!pdfJsDoc) {
        alert('Please upload a PDF before compressing.');
        return;
    }

    console.log('Compress PDF button clicked.');
    showLoadingScreen('Compressing PDF...');

    try {
        const compressedPdfDoc = await PDFLib.PDFDocument.create();
        console.log('Created new PDF document for compression.');

        const totalPages = pdfJsDoc.numPages;

        for (let i = 1; i <= totalPages; i++) {
            console.log(`Processing page ${i} of ${totalPages}...`);

            // Get the page from PDF.js
            const page = await pdfJsDoc.getPage(i);

            // Render the page to a canvas
            const viewport = page.getViewport({ scale: 2 }); // Adjust scale for higher quality
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvasContext: ctx, viewport }).promise;
            console.log(`Page ${i} rendered to canvas.`);

            // Compress the canvas to a JPEG image
            const compressedImageData = await compressCanvasImage(canvas, {
                maxWidth: 1000, // Adjust to desired maximum width
                quality: 0.7,  // Adjust JPEG quality
            });

            console.log(`Page ${i} compressed as image.`);

            // Embed the compressed image as a new page in PDF-lib
            const pageWidth = viewport.width / 2; // Adjust scale factor
            const pageHeight = viewport.height / 2;
            const pdfPage = compressedPdfDoc.addPage([pageWidth, pageHeight]);

            const embeddedImage = await compressedPdfDoc.embedJpg(compressedImageData);
            pdfPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: pageWidth,
                height: pageHeight,
            });

            console.log(`Page ${i} embedded in the new PDF.`);
            // Update progress
            const progress = Math.round((i / totalPages) * 100);
            updateProgress(progress);
        }

        console.log('All pages processed. Saving compressed PDF...');

        // Save the compressed PDF
        const compressedPdfBytes = await compressedPdfDoc.save({
            useObjectStreams: false,
        });

        console.log('Compressed PDF saved. Initiating download...');
        downloadPdf(compressedPdfBytes, 'compressed.pdf');

        alert('PDF compressed and downloaded successfully!');
    } catch (error) {
        console.error('Error during compression:', error);
        alert('An error occurred while compressing the PDF.');
    } finally {
        hideLoadingScreen();
    }
});


async function compressCanvasImage(canvas, options) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = () => resolve(new Uint8Array(reader.result));
                    reader.readAsArrayBuffer(blob);
                } else {
                    reject('Failed to compress canvas image');
                }
            },
            'image/jpeg',
            options.quality
        );
    });
}

function showLoadingScreen(message) {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingMessage = document.getElementById('loading-message');
    const progressBarFill = document.getElementById('progress-bar-fill');

    loadingMessage.textContent = message;
    progressBarFill.style.width = '0%'; // Reset the progress bar
    loadingScreen.style.display = 'flex';
}

function updateProgress(percentage) {
    const progressBarFill = document.getElementById('progress-bar-fill');
    progressBarFill.style.width = `${percentage}%`;
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'none';
}
