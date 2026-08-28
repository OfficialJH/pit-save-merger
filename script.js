// Constants mapping out the exact byte boundaries we found
const FILE_SIZE = 8192;

// Slot boundaries mapping
const SECTORS = {
    header: { start: 0, end: 11 },       // 11 bytes
    slot1_P: { start: 11, end: 2056 },   // 2045 bytes
    slot2_P: { start: 2056, end: 4080 }, // 2024 bytes
    slot1_B: { start: 4080, end: 6104 }, // 2024 bytes
    slot2_B: { start: 6104, end: 8192 }  // 2088 bytes
};

let file1Data = null;
let file2Data = null;
let dsvFooter = null; // To store DeSmuME footer if uploaded file is a .dsv

// File Reader Helper
function readFile(fileInput) {
    return new Promise((resolve, reject) => {
        const file = fileInput.files[0];
        if (!file) {
            resolve(null);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => resolve(new Uint8Array(e.target.result));
        reader.onerror = (e) => reject("Error reading file.");
        reader.readAsArrayBuffer(file);
    });
}

// Display Status Message
function showStatus(message, isError = false) {
    const statusDiv = document.getElementById('status');
    statusDiv.style.display = 'block';
    statusDiv.textContent = message;
    statusDiv.className = isError ? 'error' : 'success';
}

// Trigger File Download
function downloadFile(dataArray, filename) {
    const blob = new Blob([dataArray], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Helper to parse dropdown values into source file data and slot number
function parseSlotSelection(value) {
    const file = value.startsWith('f1') ? file1Data : file2Data;
    const slot = value.endsWith('s1') ? 1 : 2;
    return { file, slot };
}

// Copies primary and backup sector data from any source slot into a target slot
function copySlotData(sourceData, sourceSlot, targetSlot, mergedData) {
    const srcP = sourceSlot === 1 ? SECTORS.slot1_P : SECTORS.slot2_P;
    const srcB = sourceSlot === 1 ? SECTORS.slot1_B : SECTORS.slot2_B;

    const tgtP = targetSlot === 1 ? SECTORS.slot1_P : SECTORS.slot2_P;
    const tgtB = targetSlot === 1 ? SECTORS.slot1_B : SECTORS.slot2_B;

    // Copy Primary Sector
    const pData = sourceData.subarray(srcP.start, srcP.end);
    mergedData.set(pData.subarray(0, Math.min(pData.length, tgtP.end - tgtP.start)), tgtP.start);

    // Copy Backup Sector
    const bData = sourceData.subarray(srcB.start, srcB.end);
    mergedData.set(bData.subarray(0, Math.min(bData.length, tgtB.end - tgtB.start)), tgtB.start);
}

// Main Merge Logic
document.getElementById('merge-btn').addEventListener('click', async () => {
    const file1Input = document.getElementById('file1');
    const file2Input = document.getElementById('file2');

    if (!file1Input.files[0] || !file2Input.files[0]) {
        showStatus("Please upload both File 1 and File 2 before merging.", true);
        return;
    }

    try {
        file1Data = await readFile(file1Input);
        file2Data = await readFile(file2Input);

        // Validate sizes
        if (file1Data.length < FILE_SIZE || file2Data.length < FILE_SIZE) {
            showStatus("Error: One or both files are too small to be valid PiT saves.", true);
            return;
        }

        // Capture .dsv footer if it exists (usually 122 bytes added by DeSmuME)
        if (file1Data.length > FILE_SIZE) {
            dsvFooter = file1Data.subarray(FILE_SIZE);
        } else if (file2Data.length > FILE_SIZE) {
            dsvFooter = file2Data.subarray(FILE_SIZE);
        }

        // Prepare merged array (standard 8KB)
        const mergedData = new Uint8Array(FILE_SIZE);
        
        // Keep File 1's header as the master global header
        mergedData.set(file1Data.subarray(SECTORS.header.start, SECTORS.header.end), SECTORS.header.start);

        // Process Slot 1
        const slot1Selection = parseSlotSelection(document.getElementById('slot1-source').value);
        copySlotData(slot1Selection.file, slot1Selection.slot, 1, mergedData);

        // Process Slot 2
        const slot2Selection = parseSlotSelection(document.getElementById('slot2-source').value);
        copySlotData(slot2Selection.file, slot2Selection.slot, 2, mergedData);

        // Handle Export Formatting
        const exportFormat = document.getElementById('export-format').value;
        let finalOutput;

        if (exportFormat === 'dsv') {
            if (dsvFooter) {
                // Stitch the 8KB save and the DeSmuME footer together
                finalOutput = new Uint8Array(FILE_SIZE + dsvFooter.length);
                finalOutput.set(mergedData, 0);
                finalOutput.set(dsvFooter, FILE_SIZE);
            } else {
                // If no footer was found in uploads, just export raw data as .dsv (emulators usually accept this)
                finalOutput = mergedData; 
            }
            downloadFile(finalOutput, "PiT_Merged.dsv");
        } else {
            // Export raw .sav
            finalOutput = mergedData;
            downloadFile(finalOutput, "PiT_Merged.sav");
        }

        showStatus("Files successfully merged and downloaded!");

    } catch (error) {
        showStatus(error, true);
        console.error(error);
    }
});


// File Converter Logic
document.getElementById('convert-btn').addEventListener('click', async () => {
    const convertInput = document.getElementById('fileConvert');
    
    if (!convertInput.files[0]) {
        alert("Please select a file to convert.");
        return;
    }

    const file = convertInput.files[0];

    try {
        const inputData = await readFile(convertInput);

        if (!inputData || inputData.length < FILE_SIZE) {
            alert("Error: File is too small to be a valid save.");
            return;
        }

        let outputData;
        let outputFilename;
        const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

        // If file > 8192 bytes, it has a .dsv footer -> Strip footer to output .sav
        if (inputData.length > FILE_SIZE) {
            outputData = inputData.subarray(0, FILE_SIZE);
            outputFilename = `${baseName}.sav`;
            
            // Cache footer in case user wants to export back to dsv later
            dsvFooter = inputData.subarray(FILE_SIZE); 
        } 
        // If file == 8192 bytes, it's a raw .sav -> Append footer (or convert) to output .dsv
        else {
            const footer = dsvFooter || new TextEncoder().encode("|<-DeSmuME Save State Format->|");
            outputData = new Uint8Array(FILE_SIZE + footer.length);
            outputData.set(inputData, 0);
            outputData.set(footer, FILE_SIZE);
            outputFilename = `${baseName}.dsv`;
        }

        downloadFile(outputData, outputFilename);
        document.getElementById('convertModal').close();
        convertInput.value = '';

    } catch (error) {
        alert('Conversion failed: ${error}');
        console.error(error);
    }
});