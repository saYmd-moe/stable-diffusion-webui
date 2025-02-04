var acConfig = null;

// Style for new elements. Gets appended to the Gradio root.
let autocompleteCSS_dark = `
    .autocompleteResults {
        position: absolute;
        z-index: 999;
        margin: 5px 0 0 0;
        background-color: #0b0f19 !important;
        border: 1px solid #4b5563 !important;
        border-radius: 12px !important;
        overflow-y: auto;
    }
    .autocompleteResultsList > li:nth-child(odd) {
        background-color: #111827;
    }
    .autocompleteResultsList > li {
        list-style-type: none;
        padding: 10px;
        cursor: pointer;
    }
    .autocompleteResultsList > li:hover {
        background-color: #1f2937;
    }
    .autocompleteResultsList > li.selected {
        background-color: #374151;
    }
`;
let autocompleteCSS_light = `
    .autocompleteResults {
        position: absolute;
        z-index: 999;
        margin: 5px 0 0 0;
        background-color: #ffffff !important;
        border: 1.5px solid #e5e7eb !important;
        border-radius: 12px !important;
        overflow-y: auto;
    }
    .autocompleteResultsList > li:nth-child(odd) {
        background-color: #f9fafb;
    }
    .autocompleteResultsList > li {
        list-style-type: none;
        padding: 10px;
        cursor: pointer;
    }
    .autocompleteResultsList > li:hover {
        background-color: #f5f6f8;
    }
    .autocompleteResultsList > li.selected {
        background-color: #e5e7eb;
    }
`;

// Parse the CSV file into a 2D array. Doesn't use regex, so it is very lightweight.
function parseCSV(str) {
    var arr = [];
    var quote = false;  // 'true' means we're inside a quoted field

    // Iterate over each character, keep track of current row and column (of the returned array)
    for (var row = 0, col = 0, c = 0; c < str.length; c++) {
        var cc = str[c], nc = str[c + 1];        // Current character, next character
        arr[row] = arr[row] || [];             // Create a new row if necessary
        arr[row][col] = arr[row][col] || '';   // Create a new column (start with empty string) if necessary

        // If the current character is a quotation mark, and we're inside a
        // quoted field, and the next character is also a quotation mark,
        // add a quotation mark to the current column and skip the next character
        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }

        // If it's just one quotation mark, begin/end quoted field
        if (cc == '"') { quote = !quote; continue; }

        // If it's a comma and we're not in a quoted field, move on to the next column
        if (cc == ',' && !quote) { ++col; continue; }

        // If it's a newline (CRLF) and we're not in a quoted field, skip the next character
        // and move on to the next row and move to column 0 of that new row
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }

        // If it's a newline (LF or CR) and we're not in a quoted field,
        // move on to the next row and move to column 0 of that new row
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        if (cc == '\r' && !quote) { ++row; col = 0; continue; }

        // Otherwise, append the current character to the current column
        arr[row][col] += cc;
    }
    return arr;
}

// Load file
function readFile(filePath) {
    let request = new XMLHttpRequest();
    request.open("GET", filePath, false);
    request.send(null);
    return request.responseText;
}

function loadCSV() {
    let text = readFile(`file/tags/${acConfig.tagFile}`);
    return parseCSV(text);
}

// Debounce function to prevent spamming the autocomplete function
var dbTimeOut;
const debounce = (func, wait = 300) => {
    return function (...args) {
        if (dbTimeOut) {
            clearTimeout(dbTimeOut);
        }

        dbTimeOut = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    }
}

// Difference function to fix duplicates not being seen as changes in normal filter
function difference(a, b) {
    if (a.length == 0) {
        return b;
    }
    if (b.length == 0) {
        return a;
    }

    return [...b.reduce((acc, v) => acc.set(v, (acc.get(v) || 0) - 1),
        a.reduce((acc, v) => acc.set(v, (acc.get(v) || 0) + 1), new Map())
    )].reduce((acc, [v, count]) => acc.concat(Array(Math.abs(count)).fill(v)), []);
}
// Get the identifier for the text area to differentiate between positive and negative
function getTextAreaIdentifier(textArea) {
    let txt2img_n = gradioApp().querySelector('#negative_prompt > label > textarea');
    let img2img = gradioApp().querySelector('#tab_img2img');
    let img2img_p = img2img.querySelector('#img2img_prompt > label > textarea');
    let img2img_n = img2img.querySelector('#negative_prompt > label > textarea');

    let modifier = "";
    if (textArea === img2img_p || textArea === img2img_n) {
        modifier += ".img2img";
    }
    if (textArea === txt2img_n || textArea === img2img_n) {
        modifier += ".n";
    } else {
        modifier += ".p";
    }
    return modifier;
}

// Create the result list div and necessary styling
function createResultsDiv(textArea) {
    let resultsDiv = document.createElement("div");
    let resultsList = document.createElement('ul');

    let textAreaId = getTextAreaIdentifier(textArea);
    let typeClass = textAreaId.replaceAll(".", " ");

    resultsDiv.style.setProperty("max-height", acConfig.maxResults * 50 + "px");
    resultsDiv.setAttribute('class', `autocompleteResults ${typeClass}`);
    resultsList.setAttribute('class', 'autocompleteResultsList');
    resultsDiv.appendChild(resultsList);

    return resultsDiv;
}

// The selected tag index. Needs to be up here so hide can access it.
var selectedTag = null;
var previousTags = [];

// Show or hide the results div
function isVisible(textArea) {
    let textAreaId = getTextAreaIdentifier(textArea);
    let resultsDiv = gradioApp().querySelector('.autocompleteResults' + textAreaId);
    return resultsDiv.style.display === "block";
}
function showResults(textArea) {
    let textAreaId = getTextAreaIdentifier(textArea);

    let resultsDiv = gradioApp().querySelector('.autocompleteResults' + textAreaId);
    resultsDiv.style.display = "block";
}
function hideResults(textArea) {
    let textAreaId = getTextAreaIdentifier(textArea);

    let resultsDiv = gradioApp().querySelector('.autocompleteResults' + textAreaId);
    resultsDiv.style.display = "none";
    selectedTag = null;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

let hideBlocked = false;
// On click, insert the tag into the prompt textbox with respect to the cursor position
function insertTextAtCursor(textArea, result, tagword) {
    let text = result[0];
    let tagType = result[1];

    let cursorPos = textArea.selectionStart;
    var sanitizedText = text

    // Replace differently depending on if it's a tag or wildcard
    if (tagType === "wildcardFile") {
        sanitizedText = "__" + text.replace("Wildcards: ", "") + "__";
    } else if (tagType === "wildcardTag") {
        sanitizedText = text.replace(/^.*?: /g, "");
    } else {
        sanitizedText = acConfig.replaceUnderscores ? text.replaceAll("_", " ") : text;
    }

    sanitizedText = acConfig.escapeParentheses ? sanitizedText.replaceAll("(", "\\(").replaceAll(")", "\\)") : sanitizedText;

    var prompt = textArea.value;


    // Edit prompt text
    let editStart = Math.max(cursorPos - tagword.length, 0);
    let editEnd = Math.min(cursorPos + tagword.length, prompt.length);
    let surrounding = prompt.substring(editStart, editEnd);
    let match = surrounding.match(new RegExp(escapeRegExp(`${tagword}`)));
    let afterInsertCursorPos = editStart + match.index + sanitizedText.length;

    var optionalComma = "";
    if (tagType !== "wildcardFile") {
        optionalComma = surrounding.match(new RegExp(escapeRegExp(`${tagword},`))) !== null ? "" : ", ";
    }

    // Replace partial tag word with new text, add comma if needed
    let insert = surrounding.replace(tagword, sanitizedText + optionalComma);

    // Add back start
    var newPrompt = prompt.substring(0, editStart) + insert + prompt.substring(editEnd);
    textArea.value = newPrompt;
    textArea.selectionStart = afterInsertCursorPos + optionalComma.length;
    textArea.selectionEnd = textArea.selectionStart

    // Since we've modified a Gradio Textbox component manually, we need to simulate an `input` DOM event to ensure its
    // internal Svelte data binding remains in sync.
    textArea.dispatchEvent(new Event("input", { bubbles: true }));

    // Update previous tags with the edited prompt to prevent re-searching the same term
    let tags = newPrompt.match(/[^, ]+/g);
    previousTags = tags;

    // Hide results after inserting
    if (tagType === "wildcardFile") {
        // If it's a wildcard, we want to keep the results open so the user can select another wildcard
        hideBlocked = true;
        autocomplete(textArea, prompt, sanitizedText);
        setTimeout(() => { hideBlocked = false; }, 100);
    } else {
        hideResults(textArea);
    }
}

function addResultsToList(textArea, results, tagword) {
    let textAreaId = getTextAreaIdentifier(textArea);
    let resultsList = gradioApp().querySelector('.autocompleteResults' + textAreaId + ' > ul');
    resultsList.innerHTML = "";

    // Find right colors from config
    let tagFileName = acConfig.tagFile.split(".")[0];
    let tagColors = acConfig.colors;

    let mode = gradioApp().querySelector('.dark') ? 0 : 1;

    for (let i = 0; i < results.length; i++) {
        let result = results[i];
        let li = document.createElement("li");
        li.innerHTML = result[0];

        // Wildcards have no tag type
        if (!result[1].startsWith("wildcard")) {
            // Set the color of the tag
            let tagType = result[1];
            let colorGroup = tagColors[tagFileName];
            // Default to danbooru scheme if no matching one is found
            if (colorGroup === undefined) colorGroup = tagColors["danbooru"];

            li.style = `color: ${colorGroup[tagType][mode]};`;
        }

        // Add listener
        li.addEventListener("click", function () { insertTextAtCursor(textArea, result, tagword); });
        // Add element to list
        resultsList.appendChild(li);
    }
}

function updateSelectionStyle(textArea, num) {
    let textAreaId = getTextAreaIdentifier(textArea);
    let resultDiv = gradioApp().querySelector('.autocompleteResults' + textAreaId);
    let resultsList = resultDiv.querySelector('ul');
    let items = resultsList.getElementsByTagName('li');

    for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
    }

    items[num].classList.add('selected');

    // Set scrolltop to selected item if we are showing more than max results
    if (items.length > acConfig.maxResults) {
        let selected = items[num];
        resultDiv.scrollTop = selected.offsetTop - resultDiv.offsetTop;
    }
}

wildcardFiles = [];
wildcards = {};
allTags = [];
results = [];
tagword = "";
resultCount = 0;
function autocomplete(textArea, prompt, fixedTag = null) {
    // Guard for empty prompt
    if (prompt.length === 0) {
        hideResults(textArea);
        return;
    }

    if (fixedTag === null) {
        // Match tags with RegEx to get the last edited one
        let tags = prompt.match(/[^, ]+/g);
        let diff = difference(tags, previousTags)
        previousTags = tags;

        // Guard for no difference / only whitespace remaining
        if (diff === null || diff.length === 0) {
            if (!hideBlocked) hideResults(textArea);
            return;
        }

        tagword = diff[0]

        // Guard for empty tagword
        if (tagword === null || tagword.length === 0) {
            hideResults(textArea);
            return;
        }
    } else {
        tagword = fixedTag;
    }

    tagword = tagword.toLowerCase();

    if ([...tagword.matchAll(/\b__([^,_ ]+)__([^, ]*)\b/g)].length > 0 && acConfig.useWildcards) {
        // Show wildcards from a file with that name
        wcMatch = [...tagword.matchAll(/\b__([^,_ ]+)__([^, ]*)\b/g)]
        let wcFile = wcMatch[0][1];
        let wcWord = wcMatch[0][2];
        results = wildcards[wcFile].filter(x => (wcWord !== null) ? x.toLowerCase().includes(wcWord) : x) // Filter by tagword
            .map(x => [wcFile + ": " + x.trim(), "wildcardTag"]); // Mark as wildcard
    } else if ((tagword.startsWith("__") && !tagword.endsWith("__") || tagword === "__") && acConfig.useWildcards) {
        // Show available wildcard files
        let tempResults = [];
        if (tagword !== "__") {
            tempResults = wildcardFiles.filter(x => x.toLowerCase().includes(tagword.replace("__", ""))) // Filter by tagword
        } else {
            tempResults = wildcardFiles;
        }
        results = tempResults.map(x => ["Wildcards: " + x.trim(), "wildcardFile"]); // Mark as wildcard
    } else {
        results = allTags.filter(x => x[0].toLowerCase().includes(tagword)).slice(0, acConfig.maxResults);
    }
    resultCount = results.length;

    // Guard for empty results
    if (resultCount === 0) {
        hideResults(textArea);
        return;
    }

    selectedTag = null; // Reset since the list changed
    showResults(textArea);
    addResultsToList(textArea, results, tagword);
}

function navigateInList(textArea, event) {
    validKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"];

    if (!validKeys.includes(event.key)) return;
    if (!isVisible(textArea)) return

    switch (event.key) {
        case "ArrowUp":
            if (selectedTag === null) {
                selectedTag = resultCount - 1;
            } else {
                selectedTag = (selectedTag - 1 + resultCount) % resultCount;
            }
            break;
        case "ArrowDown":
            if (selectedTag === null) {
                selectedTag = 0;
            } else {
                selectedTag = (selectedTag + 1) % resultCount;
            }
            break;
        case "ArrowLeft":
            selectedTag = 0;
            break;
        case "ArrowRight":
            selectedTag = resultCount - 1;
            break;
        case "Enter":
            if (selectedTag !== null) {
                insertTextAtCursor(textArea, results[selectedTag], tagword);
            }
            break;
        case "Escape":
            hideResults(textArea);
            break;
    }
    // Update highlighting
    if (selectedTag !== null)
        updateSelectionStyle(textArea, selectedTag);

    // Prevent default behavior
    event.preventDefault();
    event.stopPropagation();
}

styleAdded = false;
onUiUpdate(function () {
    // One-time config, tags & wildcards loading
    if (acConfig === null) {
        try {
            acConfig = JSON.parse(readFile("file/tags/config.json"));
        } catch (e) {
            console.error("Error loading config.json: " + e);
            return;
        }
    }
    if (allTags.length === 0) {
        try {
            allTags = loadCSV();
        } catch (e) {
            console.error("Error loading tags file: " + e);
            return;
        }
    }
    if (wildcardFiles.length === 0 && acConfig.useWildcards) {
        try {
            wildcardFiles = readFile("file/tags/wildcardNames.txt").split("\n")
                .filter(x => !x.startsWith("//")) // Remove comments
                .filter(x => x.toLowerCase().includes(tagword.substring(2))) // Filter by tagword
                .filter(x => x.trim().length > 0) // Remove empty lines

            wildcardFiles.forEach(fName => {
                try {
                    wildcards[fName.trim()] = readFile(`file/scripts/wildcards/${fName}.txt`).split("\n")
                        .filter(x => x.trim().length > 0) // Remove empty lines
                } catch (e) {
                    console.log(`Could not load wildcards for ${fName}`);
                }
            });
        } catch (e) {
            console.error("Error loading wildcardNames.txt: " + e);
        }
    }

    // Find all textareas
    let txt2imgTextArea = gradioApp().querySelector('#txt2img_prompt > label > textarea');
    let img2imgTextArea = gradioApp().querySelector('#img2img_prompt > label > textarea');
    let negativeTextAreas = Array.from(gradioApp().querySelectorAll('#negative_prompt > label > textarea'));
    let textAreas = [txt2imgTextArea, img2imgTextArea, negativeTextAreas[0], negativeTextAreas[1]];

    // Not found, we're on a page without prompt textareas
    if (textAreas.every(v => v === null || v === undefined)) return;
    // Already added?
    if (gradioApp().querySelector('.autocompleteResults.p') !== null
        && (gradioApp().querySelector('.autocompleteResults.n') === null
            && !acConfig.activeIn.negativePrompts)) {
        return;
    }

    textAreas.forEach(area => {
        // Skip directly if not found on the page
        if (area === null || area === undefined) return;

        // Return if autocomplete is disabled for the current area type in config
        let textAreaId = getTextAreaIdentifier(area);
        if (textAreaId.includes("p") || (textAreaId.includes("n") && acConfig.activeIn.negativePrompts)) {
            if (textAreaId.includes("img2img")) {
                if (!acConfig.activeIn.img2img) return;
            } else {
                if (!acConfig.activeIn.txt2img) return;
            }
        }

        // Only add listeners once
        if (!area.classList.contains('autocomplete')) {
            // Add our new element
            var resultsDiv = createResultsDiv(area);
            area.parentNode.insertBefore(resultsDiv, area.nextSibling);
            // Hide by default so it doesn't show up on page load
            hideResults(area);

            // Add autocomplete event listener
            area.addEventListener('input', debounce(() => autocomplete(area, area.value), 100));
            // Add focusout event listener
            area.addEventListener('focusout', debounce(() => hideResults(area), 400));
            // Add up and down arrow event listener
            area.addEventListener('keydown', (e) => navigateInList(area, e));

            // Add class so we know we've already added the listeners
            area.classList.add('autocomplete');
        }
    });

    if (styleAdded) return;

    // Add style to dom
    let acStyle = document.createElement('style');
    let css = gradioApp().querySelector('.dark') ? autocompleteCSS_dark : autocompleteCSS_light;
    if (acStyle.styleSheet) {
        acStyle.styleSheet.cssText = css;
    } else {
        acStyle.appendChild(document.createTextNode(css));
    }
    gradioApp().appendChild(acStyle);
    styleAdded = true;
});