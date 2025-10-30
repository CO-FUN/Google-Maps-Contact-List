
let lastResults = [];
function getResultsAsText() {
    if (!lastResults.length) return 'No data.';
    const headers = Object.keys(lastResults[0]);
    const rows = lastResults.map(obj => headers.map(h => obj[h] || '').join(' | '));
    return [headers.join(' | '), ...rows].join('\n');
}

document.addEventListener('DOMContentLoaded', () => {
    // Show/hide Telegram settings
    const settingsBtn = document.getElementById('settingsButton');
    const telegramSettings = document.getElementById('telegramSettings');
    if (settingsBtn && telegramSettings) {
        settingsBtn.addEventListener('click', () => {
            telegramSettings.style.display = telegramSettings.style.display === 'none' ? 'flex' : 'none';
        });
    }

    // Patch populateDataTable to capture lastResults
    const origPopulate = window.populateDataTable;
    window.populateDataTable = function(table, results) {
        if (results?.[0]?.result) lastResults = results[0].result;
        origPopulate.apply(this, arguments);
        // Enable CSV download if data present
        const downloadBtn = document.getElementById('downloadCsvButton');
        if (results?.[0]?.result?.length > 0 && downloadBtn) {
            downloadBtn.disabled = false;
        }
    };

    // Hide table by default
    document.getElementById('resultsTable').style.display = 'none';

    document.getElementById('qaButton').onclick = async () => {
    const question = document.getElementById('qaInput').value;
    const answerDiv = document.getElementById('qaAnswer');
    answerDiv.textContent = 'Thinking...';
    // Show bird animation when AI is loading
    const sky = document.getElementById('sky');
    if (sky) sky.style.display = 'block';
        // Scrape Google Maps first
        chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
            const activeTab = activeTabs[0];
            chrome.scripting.executeScript({
                target: {tabId: activeTab.id},
                function: extractBusinessData
            }, async (scriptResults) => {
                window.populateDataTable(document.getElementById('resultsTable'), scriptResults);
                answerDiv.textContent = 'Information collected. Asking AI...';
                // Now send to Mistral
                const data = getResultsAsText();
                const systemInstruction = `You are an assistant that summarizes business data for Telegram. For each company, answer the user's question in a short, concise sentence specific to that company, then output the company in this format:\n\nCompany list:\n- <short answer for this company>. <name> | <phone> | <website> | <directions link>\n- ... (one per line, for each company in the data)\n\nOnly include the company list if there is data. The directions link is from the 'directions' column. Do not provide general summary but per-company answers and search on their website for more details.`;
                const prompt = `Here is a table of businesses (columns: name, phone, website, status, closing time, address, review score, reviews count, directions):\n${data}\n\nQuestion: ${question}\nAnswer:`;
                // Add timeout for fetch
                const fetchWithTimeout = (url, options, timeout = 20000) => {
                    return Promise.race([
                        fetch(url, options),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout))
                    ]);
                };
                let answer = '';
                try {
                    const response = await fetchWithTimeout('https://api.mistral.ai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'MISTRAL_API_KEY',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'mistral-small-latest',
                            messages: [
                                {role: 'system', content: systemInstruction},
                                {role: 'user', content: prompt}
                            ]
                        })
                    }, 60000);
                    if (!response.ok) {
                        let errText = await response.text();
                        answerDiv.textContent = `API error: ${response.status} ${response.statusText}. ${errText}`;
                        if (sky) sky.style.display = 'none';
                        return;
                    }
                    let result;
                    try {
                        result = await response.json();
                    } catch (jsonErr) {
                        answerDiv.textContent = 'Malformed response from AI API.';
                        if (sky) sky.style.display = 'none';
                        return;
                    }
                    if (!result.choices || !result.choices[0] || !result.choices[0].message || typeof result.choices[0].message.content !== 'string') {
                        answerDiv.textContent = 'Unexpected API response structure.';
                        if (sky) sky.style.display = 'none';
                        return;
                    }
                    answer = result.choices[0].message.content || 'No answer.';
                    answerDiv.textContent = 'Answer received. Sending to Telegram...';
                    if (sky) sky.style.display = 'none';
                } catch (e) {
                    answerDiv.textContent = 'Error: ' + (e.message || e);
                    if (sky) sky.style.display = 'none';
                    return;
                }
                const botToken = document.getElementById('telegramBotToken').value.trim();
                const chatId = document.getElementById('telegramChatId').value.trim();
                if (!botToken || !chatId) {
                    alert('Please enter your Telegram Bot Token and Chat ID.');
                    return;
                }
                const telegramMessage = `Q: ${question}\nA: ${answer}`;
                const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(telegramMessage)}`;
                try {
                    const res = await fetchWithTimeout(url, {}, 15000);
                    const data = await res.json();
                    if (data.ok) {
                        alert('Message sent to Telegram!');
                    } else {
                        alert('Telegram error: ' + (data.description || 'Unknown error'));
                    }
                } catch (e) {
                    alert('Failed to send to Telegram: ' + (e.message || e));
                }
            });
        });
    };

    document.getElementById('downloadCsvButton').onclick = async () => {
        chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
            const activeTab = activeTabs[0];
            chrome.scripting.executeScript({
                target: {tabId: activeTab.id},
                function: extractBusinessData
            }, (scriptResults) => {
                window.populateDataTable(document.getElementById('resultsTable'), scriptResults);
                const csvContent = getResultsAsText().split('\n').map(row => row.split(' | ').map(cell => '"' + cell.replace(/"/g, '""') + '"').join(',')).join('\n');
                const fileNameInput = document.getElementById('filenameInput');
                const downloadBtn = document.getElementById('downloadCsvButton');
                if (!downloadBtn) return;
                const fileName = (fileNameInput && fileNameInput.value.trim()) ? fileNameInput.value.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv' : 'google-maps-data.csv';
                const blob = new Blob([csvContent], {type: 'text/csv'});
                const downloadLink = document.createElement('a');
                downloadLink.download = fileName;
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
        });
    };

    // Telegram send message
    document.getElementById('sendTelegramButton').onclick = async () => {
        const botToken = document.getElementById('telegramBotToken').value.trim();
        const chatId = document.getElementById('telegramChatId').value.trim();
        const answer = document.getElementById('qaAnswer').textContent.trim();
        if (!botToken || !chatId) {
            alert('Please enter your Telegram Bot Token and Chat ID.');
            return;
        }
        if (!answer) {
            alert('No answer to send.');
            return;
        }
        const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(answer)}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.ok) {
                alert('Message sent to Telegram!');
            } else {
                alert('Telegram error: ' + (data.description || 'Unknown error'));
            }
        } catch (e) {
            alert('Failed to send to Telegram: ' + (e.message || e));
        }
    };

    // --- Original popup logic for scraping, download, etc. ---
    chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
        const activeTab = activeTabs[0];
        const scrapeButton = document.getElementById('actionButton');
        const downloadButton = document.getElementById('downloadCsvButton');
        const dataTable = document.getElementById('resultsTable');
        const fileNameInput = document.getElementById('filenameInput');
        const statusMessage = document.getElementById('message');

        // Check if current page is a Google Maps search
        if (activeTab && activeTab.url.includes('://www.google.com/maps/search')) {
            statusMessage.textContent = "Let's scrape Google Maps!";
            scrapeButton.disabled = false;
            scrapeButton.classList.add('enabled');
        } else {
            // Redirect user to Google Maps if not on search page
            const redirectLink = document.createElement('a');
            redirectLink.href = 'https://www.google.com/maps/search/';
            redirectLink.textContent = "Go to Google Maps Search.";
            redirectLink.target = '_blank';

            statusMessage.innerHTML = '';
            statusMessage.appendChild(redirectLink);

            scrapeButton.style.display = 'none';
            downloadButton.style.display = 'none';
            fileNameInput.style.display = 'none';
        }

        // Handle scraping action
        scrapeButton.addEventListener('click', () => {
            chrome.scripting.executeScript({
                target: {tabId: activeTab.id},
                function: extractBusinessData
            }, (scriptResults) => {
                populateDataTable(dataTable, scriptResults);

                // Enable download if data was successfully scraped
                if (scriptResults?.[0]?.result?.length > 0) {
                    downloadButton.disabled = false;
                }
            });
        });
        // Expose populateDataTable for Q&A patching
        window.populateDataTable = populateDataTable;

        // Handle CSV download
        downloadButton.addEventListener('click', () => {
            const csvContent = convertTableToCSV(dataTable);
            const fileName = sanitizeFileName(fileNameInput.value.trim()) || 'google-maps-data.csv';
            downloadCSVFile(csvContent, fileName);
        });
    });
});
// --- END: Unified DOMContentLoaded handler ---
/**
 * Google Maps Contact List Collector
 * Extracts business information from Google Maps search results
 */

document.addEventListener('DOMContentLoaded', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
        const activeTab = activeTabs[0];
        const scrapeButton = document.getElementById('actionButton');
        const downloadButton = document.getElementById('downloadCsvButton');
        const dataTable = document.getElementById('resultsTable');
        const fileNameInput = document.getElementById('filenameInput');
        const statusMessage = document.getElementById('message');

        // Check if current page is a Google Maps search
        if (activeTab && activeTab.url.includes("://www.google.com/maps/search")) {
            statusMessage.textContent = "Let's scrape Google Maps!";
            scrapeButton.disabled = false;
            scrapeButton.classList.add('enabled');
        } else {
            // Redirect user to Google Maps if not on search page
            const redirectLink = document.createElement('a');
            redirectLink.href = 'https://www.google.com/maps/search/';
            redirectLink.textContent = "Go to Google Maps Search.";
            redirectLink.target = '_blank';
            
            statusMessage.innerHTML = '';
            statusMessage.appendChild(redirectLink);
            
            scrapeButton.style.display = 'none';
            downloadButton.style.display = 'none';
            fileNameInput.style.display = 'none';
        }

        // Handle scraping action
        scrapeButton.addEventListener('click', () => {
            chrome.scripting.executeScript({
                target: {tabId: activeTab.id},
                function: extractBusinessData
            }, (scriptResults) => {
                populateDataTable(dataTable, scriptResults);
                
                // Enable download if data was successfully scraped
                if (scriptResults?.[0]?.result?.length > 0) {
                    downloadButton.disabled = false;
                }
            });
    });
    // Expose populateDataTable for Q&A patching
    window.populateDataTable = populateDataTable;

        // Handle CSV download
        downloadButton.addEventListener('click', () => {
            const csvContent = convertTableToCSV(dataTable);
            const fileName = sanitizeFileName(fileNameInput.value.trim()) || 'google-maps-data.csv';
            downloadCSVFile(csvContent, fileName);
        });
    });
});

/**
 * Extract business information from Google Maps search results
 * Executed in the context of the Google Maps page
 */
function extractBusinessData() {
    const placeAnchors = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
    return placeAnchors.map(anchor => {
        const card = anchor.closest('[jsaction*="mouseover:pane"]');
        if (!card) return null;

        // Name: prefer aria-label on the anchor
        const name = anchor.getAttribute('aria-label') || (card.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();

        // Full text to mine other values without brittle class selectors
        const text = (card.innerText || '').replace(/\s+/g, ' ').trim();

        // Rating and reviews via aria-label on [role="img"] (EN/DE/IT)
        let reviewScore = '', reviewsCount = '';
        const ratingEl = card.querySelector('[role="img"][aria-label]');
        if (ratingEl) {
            const aria = (ratingEl.getAttribute('aria-label') || '').trim();
            // Rating: first decimal number (supports comma or dot)
            const ratingMatch = aria.match(/(^|\s)([0-9]+(?:[\.,][0-9]+)?)(?=\b)/);
            if (ratingMatch) {
                reviewScore = ratingMatch[2].replace(',', '.');
            }
            // Reviews count: number followed by reviews word in EN/DE/IT
            const reviewsMatch = aria.match(/(\d{1,6})(?=[^\d]*(?:reviews?|rezensionen|recensioni))/i);
            if (reviewsMatch) {
                reviewsCount = reviewsMatch[1];
            } else {
                // Fallback: second number in aria if available (e.g., "4,7 stelle 3 recensioni")
                const nums = (aria.match(/\d{1,6}(?:[\.,]\d+)?/g) || []).map(s => s.replace(/[\.,](?=\d{3}\b)/g, ''));
                if (nums.length >= 2) {
                    reviewsCount = nums[1].replace(/[,\.]/g, '');
                }
            }
            if (/No\s+reviews|Keine\s+Rezensionen|Nessuna\s+recensione/i.test(aria)) {
                reviewScore = '';
                reviewsCount = '0';
            }
        }

        // Phone number (international tolerant) - scan line by line and skip noisy lines
        const lines = (card.innerText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
        let phone = '';
        for (const line of lines) {
            if (/(stars?|stelle|reviews?|rezensionen|recensioni|open|closed|geöffnet|geschlossen|aperto|chiuso|website|sito|directions|indicazioni)/i.test(line)) continue;
            const pm = line.match(/\+?\d[\d\s().-]{6,}\d/);
            if (pm) { phone = pm[0].replace(/\s{2,}/g, ' ').trim(); break; }
        }

        // Website: EN "Website", IT "Sito web" (prefer explicit controls; fallback to external links)
        let website = '';
        const websiteCandidates = Array.from(card.querySelectorAll('a[href^="http"]'))
            .filter(a => !/google\.[^/]+\/maps\//i.test(a.href));
        let siteLink = card.querySelector('a[data-value="Website"], a[data-value*="Sito" i], a[aria-label*="Website" i], a[aria-label*="Sito" i]');
        if (!siteLink) {
            siteLink = websiteCandidates.find(a => /\b(website|sito)\b/i.test((a.innerText || '').trim()));
        }
        if (siteLink) { website = siteLink.href; }

        // Status (open/closed) and closing time (supports EN/DE/IT)
        let status = '', closingTime = '';
        const statusMatch = text.match(/\b(Open|Closed|Geöffnet|Geschlossen|Aperto|Chiuso)\b/i);
        if (statusMatch) status = statusMatch[0];
        // 24 hours variants
        if (/24\s*(hours|ore)/i.test(text)) { closingTime = '24 hours'; }
        const closeMatch = text.match(/(?:Closes\s*(?:at\s*)?|Schlie(?:ß|ss)t\s*um|Chiude\s*(?:alle(?:\s*ore)?)?)\s*([0-2]?\d[:\.]\d{2}(?:\s*(?:am|pm))?(?:\s*[A-Za-z]{2,3})?)/i);
        if (closeMatch) closingTime = (closeMatch[1] || '').replace('.', ':').trim();
        // Handle "Opens <time> <day?>" when currently closed (e.g., "Closed ⋅ Opens 8:30 am Thu")
        if (!closingTime) {
            const opensMatch = text.match(/(?:Opens|Apre)\s+(?:alle(?:\s*ore)?)?([^⋅·|]+)/i);
            if (opensMatch) closingTime = opensMatch[1].trim();
        }
        // Handle "Open until <time>" phrasing (EN/IT)
        if (!closingTime) {
            const untilMatch = text.match(/(?:Open|Aperto)\s+(?:until|fino\s+alle(?:\s*ore)?)\s+([^⋅·|]+)/i);
            if (untilMatch) closingTime = (untilMatch[1] || '').trim();
        }

        // Address: prefer bullet-separated segments that look like addresses; fallback to line scan
        let address = '';
        const looksLikeAddress = (s) => {
            if (!s) return false;
            return /,\s*\d/.test(s) || /(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|via|viale|piazza|corso|platz|rue|calle|carrer|straße|strasse|straat)/i.test(s) || /\b\d{4,6}\b/.test(s);
        };
        const dotSeg = text.split(' · ');
        if (dotSeg.length > 1) {
            const cleaned = dotSeg
                .map(s => s.trim())
                .filter(s => !/(Open|Closed|Geöffnet|Geschlossen|Website|Direction|Directions|Route|Routen|Rezension|Reviews|stars?)/i.test(s))
                .filter(s => !/\+?\d[\d\s().-]{6,}\d/.test(s));
            address = cleaned.find(looksLikeAddress) || cleaned.slice(1).join(' · ') || cleaned[0] || '';
        }
        if (!address) {
            const parts = (card.innerText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
            address = (parts.find(looksLikeAddress) || '').trim();
        }

        // Directions link: build from coordinates in href when available
        let directions = '';
        const coord = anchor.href.match(/!3d([-0-9.]+)!4d([-0-9.]+)/);
        if (coord) {
            directions = `https://www.google.com/maps/dir/?api=1&destination=${coord[1]},${coord[2]}`;
        } else if (name) {
            directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}`;
        }

        return {
            name: name || '',
            phone,
            website,
            status,
            closingTime,
            address,
            reviewScore,
            reviewsCount,
            directions
        };
    }).filter(Boolean);
}

/**
 * Extract rating and review count from business card
 */
function extractRatingData(container) {
    const ratingElement = container.querySelector('[role="img"]');
    if (!ratingElement) return {rating: '0', reviewCount: '0'};

    const ariaLabel = ratingElement.getAttribute('aria-label');
    if (!ariaLabel?.includes("stars")) return {rating: '0', reviewCount: '0'};

    const parts = ariaLabel.split(' ');
    return {
        rating: parts[0] || '0',
        reviewCount: `(${parts[2] || '0'})`
    };
}

/**
 * Extract industry and address information
 */
function extractLocationData(container, rating, reviewCount) {
    const containerText = container.textContent || '';
    const addressPattern = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
    const addressMatch = containerText.match(addressPattern);

    if (!addressMatch) return {industry: '', address: ''};

    let address = addressMatch[0];
    let industry = '';

    // Extract industry from text before address
    const textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
    const ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
    
    if (ratingIndex !== -1) {
        const rawIndustry = textBeforeAddress
            .substring(ratingIndex + (rating + reviewCount).length)
            .trim()
            .split(/[\r\n]+/)[0];
        industry = rawIndustry.replace(/[·.,#!?]/g, '').trim();
    }

    // Clean up address text
    address = address
        .replace(/\b(Closed|Open 24 hours|24 hours|Open)\b/g, '')
        .replace(/(\d+)(Open|Closed)/g, '$1')
        .replace(/(\w)(Open|Closed)/g, '$1')
        .trim();

    return {industry, address};
}

/**
 * Extract phone number from business card
 */
function extractPhoneNumber(container) {
    const text = container.textContent || '';
    const phonePattern = /(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
    const match = text.match(phonePattern);
    return match ? match[0] : '';
}

/**
 * Extract website URL (excluding Google Maps links)
 */
function extractWebsiteURL(container) {
    const allLinks = Array.from(container.querySelectorAll('a[href]'));
    const externalLinks = allLinks.filter(link => 
        !link.href.startsWith("https://www.google.com/maps/place/")
    );
    return externalLinks[0]?.href || '';
}

/**
 * Populate the data table with scraped results
 */
function populateDataTable(table, results) {
    table.innerHTML = '';

    const headers = ['Name', 'Phone', 'Website', 'Status', 'Closing Time', 'Address', 'Review Score', 'Reviews Count', 'Directions Link'];
    const headerRow = document.createElement('tr');
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    if (!results?.[0]?.result) return;
    const fields = ['name', 'phone', 'website', 'status', 'closingTime', 'address', 'reviewScore', 'reviewsCount', 'directions'];

    // Sort by highest reviewScore, then highest reviewsCount
    const parseScore = (v) => {
        if (v == null) return 0;
        const s = String(v).replace(',', '.');
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    };
    const parseCount = (v) => {
        if (v == null) return 0;
        const s = String(v).replace(/[^0-9]/g, '');
        const n = parseInt(s || '0', 10);
        return isNaN(n) ? 0 : n;
    };

    const items = [...results[0].result].sort((a, b) => {
        const rsA = parseScore(a.reviewScore);
        const rsB = parseScore(b.reviewScore);
        if (rsB !== rsA) return rsB - rsA;
        const rcA = parseCount(a.reviewsCount);
        const rcB = parseCount(b.reviewsCount);
        if (rcB !== rcA) return rcB - rcA;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    items.forEach(item => {
        const row = document.createElement('tr');
        fields.forEach(f => {
            const td = document.createElement('td');
            td.textContent = item[f] || '';
            row.appendChild(td);
        });
        table.appendChild(row);
    });
}

/**
 * Convert HTML table to CSV format
 */
function convertTableToCSV(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    
    return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return cells.map(cell => `"${cell.innerText}"`).join(',');
    }).join('\n');
}

/**
 * Sanitize and format filename for CSV download
 */
function sanitizeFileName(fileName) {
    if (!fileName) return '';
    return fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
}

/**
 * Download CSV file to user's computer
 */
function downloadCSVFile(csvContent, fileName) {
    const blob = new Blob([csvContent], {type: 'text/csv'});
    const downloadLink = document.createElement('a');
    
    downloadLink.download = fileName;
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.style.display = 'none';
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
