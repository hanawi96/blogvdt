// Smart Paste - Auto-parse customer information
// Intelligently extracts name, phone, and address from pasted text

// ============================================
// OPTIMIZATION FLAGS (Feature Toggles)
// ============================================
// Control optimization features independently
// Set to false to disable, true to enable
const OPTIMIZATION_FLAGS = {
    NGRAM_LIMIT: true,              // Limit n-gram generation (Priority 1)
    FUZZY_EARLY_EXIT: true,         // Skip weak candidates in fuzzy match (Priority 2)
    LEVENSHTEIN_LENGTH_CHECK: true, // Skip Levenshtein for very different lengths (Priority 2)
    LEARNING_EXPANDED: true,        // Expand keyword extraction for learning DB (Priority 5)
    PROVINCE_FIRST_VALIDATION: true,// Validate district/ward within found province (Priority 3)
    LANDMARK_EXTRACTION: true       // Extract landmarks before parsing (Priority 2)
};

// Metrics tracking
const OPTIMIZATION_METRICS = {
    ngramReduction: 0,
    fuzzySkipped: 0,
    levenshteinSkipped: 0,
    rollbackCount: 0,
    provinceValidationUsed: 0,
    landmarkExtracted: 0
};

/**
 * Generate n-grams from word array
 * Used for parsing addresses without commas
 */
function generateNGrams(words, minN, maxN) {
    const ngrams = [];
    
    for (let n = maxN; n >= minN; n--) { // Start with longer phrases
        for (let i = 0; i <= words.length - n; i++) {
            const ngram = words.slice(i, i + n).join(' ');
            ngrams.push(ngram);
        }
    }
    
    return ngrams;
}

/**
 * Get Vietnam address data from addressSelector
 */
function getVietnamAddressData() {
    if (window.addressSelector && window.addressSelector.data && window.addressSelector.data.length > 0) {
        return window.addressSelector.data;
    }
    
    // Fallback: Try to get from provinceMap
    if (window.addressSelector && window.addressSelector.provinceMap && window.addressSelector.provinceMap.size > 0) {
        return Array.from(window.addressSelector.provinceMap.values());
    }
    
    console.warn('⚠️ Address data not available from addressSelector');
    return [];
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching with typos
 */
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Calculate similarity score based on edit distance
 * IMPROVED: More lenient for Vietnamese names with common typos
 */
function similarityScore(str1, str2) {
    const distance = levenshteinDistance(str1, str2);
    const maxLen = Math.max(str1.length, str2.length);
    const baseSimilarity = 1 - (distance / maxLen);
    
    // IMPROVED: Bonus for common Vietnamese typo patterns
    // Example: "thuy" vs "thụy" → "thuy" vs "thuy" (after removing tones)
    // But user might type "thuy" when they mean "thụy"
    const normalized1 = removeVietnameseTones(str1);
    const normalized2 = removeVietnameseTones(str2);
    
    // Check for common substitutions
    const commonSubstitutions = [
        { pattern: /uy/g, replacement: 'u' },  // "thuy" → "thu" to match "thụy" → "thu"
        { pattern: /y$/g, replacement: '' },   // "y" at end
        { pattern: /c$/g, replacement: 'k' },  // "bính" → "binh" (c/k confusion)
    ];
    
    let bestScore = baseSimilarity;
    
    // Try substitutions on both strings
    for (const sub of commonSubstitutions) {
        const test1 = normalized1.replace(sub.pattern, sub.replacement);
        const test2 = normalized2.replace(sub.pattern, sub.replacement);
        
        if (test1 === test2) {
            // Perfect match after substitution - give high bonus
            bestScore = Math.max(bestScore, 0.95);
        } else {
            // Partial improvement
            const testDistance = levenshteinDistance(test1, test2);
            const testSimilarity = 1 - (testDistance / Math.max(test1.length, test2.length));
            bestScore = Math.max(bestScore, testSimilarity);
        }
    }
    
    return bestScore;
}

/**
 * Remove Vietnamese tones for fuzzy matching
 */
function removeVietnameseTones(str) {
    if (!str) return '';
    return str
        .toLowerCase()        // LOWERCASE FIRST!
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')   // This won't match anymore but keep for safety
        .trim();
}

/**
 * Fuzzy match string with list of options
 * Improved for Vietnamese location names with priority keyword matching
 */
function fuzzyMatch(input, options, threshold = 0.6) {
    const normalizedInput = removeVietnameseTones(input);
    
    // Remove common prefixes for better matching
    const cleanInput = normalizedInput
        .replace(/^(tinh|thanh pho|tp|quan|huyen|phuong|xa|thi tran|tt|thi xa|tx)\s+/i, '')
        .toLowerCase()
        .trim();
    
    let bestMatch = null;
    let bestScore = 0;
    let matchType = '';
    
    // ============================================
    // OPTIMIZATION: Track skipped candidates
    // ============================================
    let skippedCount = 0;
    
    for (const option of options) {
        // ============================================
        // OPTIMIZATION: Early skip for weak candidates
        // ============================================
        if (OPTIMIZATION_FLAGS.FUZZY_EARLY_EXIT && bestScore >= 0.95) {
            // Quick length check (if length diff > 5, unlikely to match)
            const lengthDiff = Math.abs(input.length - option.Name.length);
            if (lengthDiff > 5) {
                skippedCount++;
                continue; // Skip this option
            }
        }
        
        const normalizedOption = removeVietnameseTones(option.Name);
        const cleanOption = normalizedOption
            .replace(/^(tinh|thanh pho|tp|quan|huyen|phuong|xa|thi tran|tt|thi xa|tx)\s+/i, '')
            .toLowerCase()
            .trim();
        
        let score = 0;
        let type = '';
        
        // 1. Exact match (highest priority)
        if (normalizedOption === normalizedInput || cleanOption === cleanInput) {
            // console.log(`      [EXACT] ${option.Name}: 1.00`);
            return { match: option, score: 1.0, confidence: 'high' };
        }
        
        // 2. Contains match - BOTH DIRECTIONS with priority
        // Check if input contains option (user typed more than needed)
        if (normalizedInput.includes(cleanOption) && cleanOption.length >= 4) {
            score = 0.9;
            type = 'input-contains-option';
            // console.log(`      [CONTAINS-1] ${option.Name}: ${score.toFixed(2)} (${type})`);
        }
        // Check if option contains input (user typed less)
        else if (cleanOption.includes(cleanInput) && cleanInput.length >= 4) {
            score = 0.85;
            type = 'option-contains-input';
            
            // IMPORTANT: Check word order for partial matches
            // Example: "Tân Vĩnh" should match "Tân Vĩnh Hiệp" (0.85) better than "Vĩnh Tân" (0.85 → 0.80)
            const inputWords = cleanInput.split(/\s+/).filter(w => w.length > 0);
            const optionWords = cleanOption.split(/\s+/).filter(w => w.length > 0);
            
            if (inputWords.length >= 2) {
                // Check if input words appear in same order in option
                let lastIndex = -1;
                let isSequential = true;
                
                for (const iw of inputWords) {
                    let found = false;
                    for (let j = lastIndex + 1; j < optionWords.length; j++) {
                        if (optionWords[j] === iw || optionWords[j].includes(iw) || iw.includes(optionWords[j])) {
                            lastIndex = j;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        isSequential = false;
                        break;
                    }
                }
                
                // If words are NOT in sequential order, reduce score
                if (!isSequential) {
                    score = 0.80; // Penalty for reversed/mixed order
                    type = 'option-contains-input-reversed';
                }
            }
            // console.log(`      [CONTAINS-2] ${option.Name}: ${score.toFixed(2)} (${type})`);
        }
        // Full normalized contains
        else if (normalizedOption.includes(normalizedInput) || normalizedInput.includes(normalizedOption)) {
            score = 0.8;
            type = 'contains-full';
            // console.log(`      [CONTAINS-3] ${option.Name}: ${score.toFixed(2)} (${type})`);
        }
        
        // 3. Word-by-word matching with ALL words must match
        if (score === 0) {
            const inputWords = cleanInput.split(/\s+/).filter(w => w.length > 0);
            const optionWords = cleanOption.split(/\s+/).filter(w => w.length > 0);
            
            let matchCount = 0;
            const matchedIndices = []; // Track which option word indices matched
            
            for (const iw of inputWords) {
                for (let j = 0; j < optionWords.length; j++) {
                    const ow = optionWords[j];
                    if (iw === ow || ow.includes(iw) || iw.includes(ow)) {
                        matchCount++;
                        matchedIndices.push(j);
                        break;
                    }
                }
            }
            
            if (matchCount > 0) {
                // Higher score if ALL input words matched
                if (matchCount === inputWords.length) {
                    // Check if words are in same order (sequential indices)
                    let isSequential = true;
                    for (let i = 1; i < matchedIndices.length; i++) {
                        if (matchedIndices[i] <= matchedIndices[i - 1]) {
                            isSequential = false;
                            break;
                        }
                    }
                    
                    // BONUS: Same order gets higher score
                    if (isSequential) {
                        score = 0.98; // Higher than reversed order
                        type = `word-match-sequential-${matchCount}`;
                        // console.log(`      [WORD-SEQ] ${option.Name}: ${score.toFixed(2)} (indices: ${matchedIndices.join(',')})`);
                    } else {
                        score = 0.80; // Reversed or mixed order - LOWER than contains match (0.85)
                        type = `word-match-all-${matchCount}`;
                        // console.log(`      [WORD-REV] ${option.Name}: ${score.toFixed(2)} (indices: ${matchedIndices.join(',')})`);
                    }
                } else {
                    score = (matchCount / Math.max(inputWords.length, optionWords.length)) * 0.7;
                    type = `word-match-${matchCount}/${inputWords.length}`;
                    // console.log(`      [WORD-PARTIAL] ${option.Name}: ${score.toFixed(2)} (${type})`);
                }
            }
        }
        
        // 4. Fuzzy matching with edit distance (for typos)
        if (score < 0.7) {
            // ============================================
            // OPTIMIZATION: Skip Levenshtein for very different lengths
            // ============================================
            const lengthDiff = Math.abs(cleanInput.length - cleanOption.length);
            
            // If length difference > 5, edit distance will be high anyway
            // Skip expensive calculation
            if (OPTIMIZATION_FLAGS.LEVENSHTEIN_LENGTH_CHECK && lengthDiff > 5) {
                // Skip Levenshtein calculation
                OPTIMIZATION_METRICS.levenshteinSkipped++;
            } else {
                const similarity = similarityScore(cleanInput, cleanOption);
                if (similarity > 0.6) {
                    const editScore = similarity * 0.85;
                    if (editScore > score) {
                        score = editScore;
                        type = 'edit-distance';
                    }
                }
            }
        }
        
        // Update best match
        if (score > bestScore) {
            bestScore = score;
            bestMatch = option;
            matchType = type;
        }
    }
    
    // ============================================
    // OPTIMIZATION: Log skipped candidates
    // ============================================
    if (OPTIMIZATION_FLAGS.FUZZY_EARLY_EXIT && skippedCount > 0) {
        OPTIMIZATION_METRICS.fuzzySkipped += skippedCount;
        // console.log(`  ⚡ Fuzzy: Skipped ${skippedCount}/${options.length} weak candidates`);
    }
    
    if (bestScore >= threshold) {
        const confidence = bestScore >= 0.85 ? 'high' : bestScore >= 0.65 ? 'medium' : 'low';
        return { match: bestMatch, score: bestScore, confidence };
    }
    
    return null;
}

/**
 * Extract street names from address (for learning DB)
 * Example: "135/17/43 Nguyễn Hữu Cảnh" → ["nguyễn", "hữu", "cảnh"]
 */
function extractStreetNames(text) {
    const keywords = [];
    
    // Pattern: Vietnamese name (2-4 words, capitalized)
    // Example: "Nguyễn Hữu Cảnh", "Lê Lợi", "Trần Hưng Đạo"
    const namePattern = /\b([A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+\s+){1,3}[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+/g;
    
    const matches = text.match(namePattern);
    if (matches) {
        for (const match of matches) {
            // Split into words and normalize
            const words = match.split(/\s+/)
                .map(w => removeVietnameseTones(w).toLowerCase())
                .filter(w => w.length >= 3); // Skip short words
            
            keywords.push(...words);
        }
    }
    
    return keywords;
}

/**
 * Extract street numbers from address (for learning DB)
 * Example: "135/17/43" → ["135/17/43"]
 */
function extractStreetNumbers(text) {
    const keywords = [];
    
    // Pattern: House number (123, 123/45, 123/45/67)
    const numberPattern = /\b\d+(?:\/\d+){0,2}\b/g;
    
    const matches = text.match(numberPattern);
    if (matches) {
        keywords.push(...matches);
    }
    
    return keywords;
}

/**
 * Extract landmark from address
 * Separates landmark phrases (sau chợ, gần ngã tư, etc.) from main address
 * Returns: { street, landmark, cleanAddress }
 */
function extractLandmark(addressText) {
    if (!OPTIMIZATION_FLAGS.LANDMARK_EXTRACTION) {
        return {
            street: addressText,
            landmark: null,
            cleanAddress: addressText
        };
    }
    
    // Landmark keywords (position + place types)
    const LANDMARK_KEYWORDS = [
        // Position keywords - Use word boundary patterns
        'sau chợ', 'sau cho', 'sau trường', 'sau truong', 'sau bệnh viện', 'sau benh vien',
        'sau cầu', 'sau cau', 'sau cống', 'sau cong', 'sau đình', 'sau dinh',
        'trước chợ', 'truoc cho', 'trước trường', 'truoc truong',
        'gần chợ', 'gan cho', 'gần trường', 'gan truong', 'gần bệnh viện', 'gan benh vien',
        'cạnh chợ', 'canh cho', 'đối diện chợ', 'doi dien cho',
        
        // Extension keywords
        'nối dài', 'noi dai', 'kéo dài', 'keo dai',
        
        // Place types (common landmarks) - Full phrases only
        'ngã tư', 'nga tu', 'ngã ba', 'nga ba',
        'công viên', 'cong vien', 'siêu thị', 'sieu thi',
        'chung cư', 'chung cu', 'khu dân cư', 'khu dan cu', 'kdc'
    ];
    
    // Normalize for searching
    const normalized = removeVietnameseTones(addressText).toLowerCase();
    
    // Find first landmark keyword
    let landmarkStart = -1;
    let landmarkKeyword = null;
    
    for (const keyword of LANDMARK_KEYWORDS) {
        // Use word boundary regex to avoid false matches
        // Example: "sau chợ" should match "sau chợ" but NOT "phường sau"
        const keywordNormalized = removeVietnameseTones(keyword).toLowerCase();
        
        // Build regex with word boundary at start
        // For multi-word keywords, use flexible spacing
        const regexPattern = '\\b' + keywordNormalized.replace(/\s+/g, '\\s+');
        const regex = new RegExp(regexPattern, 'i');
        const match = normalized.match(regex);
        
        if (match) {
            const matchIndex = match.index;
            
            // CRITICAL FIX: Check if landmark keyword comes BEFORE location keywords
            // If landmark is AFTER location keywords (xã, phường, quận, tỉnh), it's likely a false positive
            // Example: "phường 14 gò vấp" → "gò" should NOT be treated as landmark
            const beforeLandmark = normalized.substring(0, matchIndex);
            const hasLocationKeywordBefore = /\b(xa|phuong|quan|huyen|thi xa|thanh pho|tinh)\b/i.test(beforeLandmark);
            
            if (hasLocationKeywordBefore) {
                // Skip this match - it's likely part of a location name, not a landmark
                console.log(`  ⚠️ Skipping landmark after location keyword: "${keyword}"`);
                continue;
            }
            
            // CRITICAL FIX 2: Validate landmark context
            // Check if this is really a landmark or just part of a name
            const afterKeyword = normalized.substring(matchIndex + keywordNormalized.length).trim();
            
            // If there are location keywords AFTER this, it's likely part of address structure
            const hasLocationAfter = /\b(xa|phuong|quan|huyen|thi xa|thanh pho|tinh)\b/i.test(afterKeyword);
            
            if (hasLocationAfter) {
                // This is likely part of address structure, not a landmark
                console.log(`  ⚠️ Skipping landmark before location keyword: "${keyword}"`);
                continue;
            }
            
            if (landmarkStart === -1 || matchIndex < landmarkStart) {
                landmarkStart = matchIndex;
                landmarkKeyword = keyword;
            }
        }
    }
    
    if (landmarkStart === -1) {
        // No landmark found
        return {
            street: addressText,
            landmark: null,
            cleanAddress: addressText
        };
    }// Find where landmark ends
    let landmarkEnd = addressText.length;
    
    // Strategy 1: Look for comma after landmark
    const afterLandmark = addressText.substring(landmarkStart);
    const commaMatch = afterLandmark.match(/[,，]/);
    if (commaMatch) {
        landmarkEnd = landmarkStart + commaMatch.index;
    } else {
        // Strategy 2: Landmark is typically 2-4 words
        // Extract 2-4 words after landmark keyword, then check if remaining looks like location
        const afterLandmarkNormalized = normalized.substring(landmarkStart);
        const words = afterLandmarkNormalized.split(/\s+/);
        
        // Try 2, 3, 4 words for landmark
        for (const wordCount of [2, 3, 4]) {
            if (words.length > wordCount) {
                // Get potential landmark (e.g., "sau dinh hau duong")
                const potentialLandmark = words.slice(0, wordCount).join(' ');
                
                // Get remaining text after potential landmark
                const remainingText = words.slice(wordCount).join(' ');
                
                // Check if remaining text looks like a location (contains common district/province names)
                // Common patterns: "dong anh", "ha noi", "quan 1", "phuong 14"
                const hasLocationPattern = 
                    /\b(quan|huyen|phuong|xa|tinh|thanh pho|tp)\b/.test(remainingText) || // Has location keyword
                    /\b(ha noi|ho chi minh|hcm|da nang|hai phong|can tho)\b/.test(remainingText) || // Major cities
                    /\b[a-z]+\s+(anh|binh|dong|tay|nam|bac|trung)\b/.test(remainingText); // Common district patterns
                
                if (hasLocationPattern) {
                    // This looks like a location - landmark ends here
                    landmarkEnd = landmarkStart + potentialLandmark.length;
                    break;
                }
            }
        }
        
        // If still no match, default to 3 words
        if (landmarkEnd === addressText.length && words.length > 3) {
            const defaultLandmark = words.slice(0, 3).join(' ');
            landmarkEnd = landmarkStart + defaultLandmark.length;
        }
    }
    
    // Extract parts
    let street = addressText.substring(0, landmarkStart).trim();
    const landmark = addressText.substring(landmarkStart, landmarkEnd).trim();
    let remaining = addressText.substring(landmarkEnd).trim();
    
    // Remove leading comma from remaining
    remaining = remaining.replace(/^[,，]\s*/, '');
    
    // SMART FIX: If street is empty, extract text between landmark phrase and next separator
    // Example: "Công ty formosa - kỳ liên" → street should be "formosa", not empty
    let finalStreet = street;
    if (!street && landmark) {
        // Look for separator after landmark in remaining text
        // Example: "formosa - kỳ liên" → take "formosa"
        const separatorMatch = remaining.match(/[\-,，]/);
        if (separatorMatch) {
            // Take text before first separator
            finalStreet = remaining.substring(0, separatorMatch.index).trim();
            // Update remaining to exclude the extracted street
            remaining = remaining.substring(separatorMatch.index + 1).trim();
        } else {
            // No separator - check if remaining has multiple words
            const words = remaining.split(/\s+/);
            if (words.length > 2) {
                // Take first 1-2 words as street (company/building name)
                finalStreet = words.slice(0, 2).join(' ');
                remaining = words.slice(2).join(' ');
            } else {
                // Use all remaining as street
                finalStreet = remaining;
                remaining = '';
            }
        }
    }
    
    // SMART: Add commas to remaining if it doesn't have any
    // This helps parsing when address has no commas: "đông anh hà nội" → "đông anh, hà nội"
    if (remaining && !remaining.includes(',')) {
        // CRITICAL: If remaining has dashes, convert them to commas first
        // Example: "kỳ liên - kỳ anh - hà tĩnh" → "kỳ liên, kỳ anh, hà tĩnh"
        if (remaining.includes('-')) {
            remaining = remaining.replace(/\s*-\s*/g, ', ');
        } else {
            const remainingNormalized = removeVietnameseTones(remaining).toLowerCase();
            
            // Try to detect location names (district/province) and add commas between them
            // Common patterns:
            // - "dong anh ha noi" → "dong anh, ha nội" (2 words + 2 words)
            // - "quan 10 ho chi minh" → "quan 10, ho chi minh" (keyword + name)
            
            // Strategy 1: Look for major city names
            const majorCities = ['ha noi', 'ho chi minh', 'hcm', 'da nang', 'hai phong', 'can tho', 'bien hoa', 'vung tau', 'nha trang', 'hue'];
            
            for (const city of majorCities) {
                const cityIndex = remainingNormalized.indexOf(city);
                if (cityIndex > 0) {
                    // Found city name - add comma before it
                    const beforeCity = remaining.substring(0, cityIndex).trim();
                    const cityPart = remaining.substring(cityIndex).trim();
                    remaining = beforeCity + ', ' + cityPart;
                    break;
                }
            }
            
            // Strategy 2: If still no comma and has 4+ words, split at midpoint
            if (!remaining.includes(',') && remaining.split(/\s+/).length >= 4) {
                const words = remaining.split(/\s+/);
                const midPoint = Math.floor(words.length / 2);
                remaining = words.slice(0, midPoint).join(' ') + ', ' + words.slice(midPoint).join(' ');
            }
        }
    }
    
    // Reconstruct without landmark
    const cleanAddress = (finalStreet ? finalStreet + ', ' : '') + remaining;
    
    return {
        street: finalStreet,
        landmark,
        cleanAddress
    };
}

/**
 * Extract phone number from text
 */
function extractPhoneNumber(text) {
    // Vietnamese phone: starts with 0 or +84, network prefix 3/5/7/8/9, total 10 digits
    const phoneRegex = /(?:0|\+84)[35789]\d{8}/g;
    let matches = text.match(phoneRegex);

    if (matches && matches.length > 0) {
        const phone = matches[0].replace(/\+84/, '0');
        return { phone, confidence: 'high', original: matches[0] };
    }

    // Fallback: 9-digit number missing leading 0 (e.g. 984923405)
    const fallbackRegex = /(?<!\d)[35789]\d{8}(?!\d)/g;
    matches = text.match(fallbackRegex);
    if (matches && matches.length > 0) {
        const phone = '0' + matches[0];
        return { phone, confidence: 'high', original: matches[0] };
    }

    return null;
}

/**
 * Extract customer name from text
 * Usually the last line or a short text without numbers
 */
function extractCustomerName(lines, phoneInfo) {
    // Remove lines that contain phone or address keywords
    const addressKeywords = [
        'phường', 'xã', 'quận', 'huyện', 'thành phố', 'tỉnh', 'tp', 
        'đường', 'phố', 'thôn', 'thon', 'xa', 'xom', 'xóm', 'ấp', 'ap', 
        'khu', 'số', 'so', 'đống', 'dong', 'ngõ', 'ngo', 'hem', 'hẻm',
        'khóm', 'khom', 'thị trấn', 'thi tran', 'tt', 'thị xã', 'thi xa', 'tx',
        'tầng', 'tang', 'tòa', 'toa', 'lầu', 'lau' // Building/floor keywords
    ];
    
    // IMPROVED: Common Vietnamese place names (cities, districts, provinces)
    // These indicate the line is an address, not a name
    const placeNames = [
        // Major cities
        'ha noi', 'ho chi minh', 'hcm', 'sai gon', 'da nang', 'hai phong', 'can tho',
        'bien hoa', 'vung tau', 'nha trang', 'hue', 'phan thiet', 'da lat', 'quy nhon',
        'vinh', 'hai duong', 'nam dinh', 'thai nguyen', 'bac ninh', 'long xuyen',
        
        // Common districts/areas
        'tan binh', 'tan phu', 'binh thanh', 'go vap', 'thu duc', 'binh tan',
        'phu nhuan', 'quan 1', 'quan 2', 'quan 3', 'quan 4', 'quan 5',
        'dong anh', 'gia lam', 'long bien', 'cau giay', 'ha dong', 'thanh xuan',
        'me linh', 'soc son', 'ba dinh', 'hoan kiem', 'tay ho',
        
        // Common wards/communes
        'phu hoa', 'phu hoai', 'tan thanh', 'binh hung', 'binh tri',
        'an phu', 'an khanh', 'thao dien', 'cat lai', 'thu thiem',
        'phuoc long', 'phuoc hoa', 'tan phuoc', 'tan quy', 'tan son',
        
        // Provinces
        'binh duong', 'dong nai', 'ba ria', 'vung tau', 'long an', 'tien giang',
        'ben tre', 'tra vinh', 'vinh long', 'an giang', 'kien giang', 'ca mau',
        'bac lieu', 'soc trang', 'hau giang', 'can tho', 'dong thap',
        'lam dong', 'binh phuoc', 'tay ninh', 'binh thuan', 'ninh thuan',
        'khanh hoa', 'phu yen', 'binh dinh', 'quang ngai', 'quang nam',
        'quang tri', 'quang binh', 'ha tinh', 'nghe an', 'thanh hoa',
        'ninh binh', 'nam dinh', 'thai binh', 'hai duong', 'hung yen',
        'bac giang', 'bac kan', 'cao bang', 'ha giang', 'lang son',
        'lao cai', 'yen bai', 'tuyen quang', 'phu tho', 'vinh phuc',
        'thai nguyen', 'son la', 'dien bien', 'lai chau', 'hoa binh',
        'dak lak', 'dak nong', 'gia lai', 'kon tum'
    ];
    
    console.log('🔍 Extracting name from', lines.length, 'lines:', lines);
    
    const candidateLines = lines.filter(line => {
        const lower = line.toLowerCase();
        const normalized = removeVietnameseTones(lower);
        
        // Skip if contains phone (check both normalized and original 9-digit form)
        if (phoneInfo && (line.includes(phoneInfo.phone) || (phoneInfo.original && line.includes(phoneInfo.original)))) {
            console.log(`  ✗ Skip (has phone): "${line}"`);
            return false;
        }
        
        // Skip if contains district abbreviations (Q1, Q2, P1, P2, etc.)
        if (/\b[qp]\d+\b/i.test(line)) {
            console.log(`  ✗ Skip (has district abbreviation): "${line}"`);
            return false;
        }
        
        // Skip if contains address keywords
        if (addressKeywords.some(kw => normalized.includes(kw))) {
            console.log(`  ✗ Skip (has address keyword): "${line}"`);
            return false;
        }
        
        // IMPROVED: Skip if contains place names
        if (placeNames.some(place => normalized.includes(place))) {
            console.log(`  ✗ Skip (has place name): "${line}"`);
            return false;
        }
        
        // IMPROVED: Skip if starts with house number pattern
        // Pattern: "123 Street Name" or "123/45 Street Name"
        if (/^\d+[\/\-]?\d*\s+[a-zA-ZÀ-ỹ]/.test(line)) {
            console.log(`  ✗ Skip (starts with house number): "${line}"`);
            return false;
        }
        
        // Skip if too long (likely address)
        if (line.length > 50) {
            console.log(`  ✗ Skip (too long): "${line}"`);
            return false;
        }
        
        // IMPROVED: Skip if contains too many numbers OR has slash/dash in numbers
        // "59 phan huy ich" has 2 digits but "59/1" would have slash
        const numberCount = (line.match(/\d/g) || []).length;
        const hasNumberSlash = /\d+[\/\-]\d+/.test(line);
        
        if (numberCount > 2 || hasNumberSlash) {
            console.log(`  ✗ Skip (too many numbers or has number slash): "${line}"`);
            return false;
        }
        
        console.log(`  ✓ Candidate: "${line}"`);
        return true;
    });
    
    if (candidateLines.length === 0) {
        console.log('  ❌ No name candidates found');
        return null;
    }
    
    // Prefer last line (common pattern)
    const lastLine = candidateLines[candidateLines.length - 1].trim();
    
    // Validate name (2-50 chars, mostly letters)
    if (lastLine.length >= 2 && lastLine.length <= 50) {
        const letterCount = (lastLine.match(/[a-zA-ZÀ-ỹ]/g) || []).length;
        if (letterCount / lastLine.length > 0.7) {
            console.log(`  ✅ Name extracted: "${lastLine}"`);
            return {
                name: lastLine,
                confidence: candidateLines.length === 1 ? 'high' : 'medium'
            };
        }
    }
    
    console.log('  ❌ No valid name found');
    return null;
}

// ============================================
// POSITION-AWARE SHORT CODE EXPANSION
// ============================================
// Mã viết tắt tỉnh/huyện 2 ký tự CHỈ được expand khi nằm ở vị trí hợp lý:
//   - Mã tỉnh: segment cuối cùng (sau dấu phẩy cuối) hoặc từ cuối cùng
//   - Mã huyện: segment áp chót
// Nguyên nhân: mã 2 ký tự như "na", "la", "cm", "kg" trùng với
// từ tiếng Việt/đơn vị đo, gây nhận diện sai khi expand vô điều kiện.

const PROVINCE_SHORT_CODES = {
    'bn': 'Bắc Ninh', 'bg': 'Bắc Giang', 'bk': 'Bắc Kạn',
    'hb': 'Hòa Bình', 'hy': 'Hưng Yên', 'ls': 'Lạng Sơn',
    'lc': 'Lào Cai', 'nb': 'Ninh Bình', 'pt': 'Phú Thọ',
    'sl': 'Sơn La', 'tb': 'Thái Bình', 'tq': 'Tuyên Quang',
    'vp': 'Vĩnh Phúc', 'yb': 'Yên Bái', 'na': 'Nghệ An',
    'ht': 'Hà Tĩnh', 'qb': 'Quảng Bình', 'qt': 'Quảng Trị',
    'py': 'Phú Yên', 'kh': 'Khánh Hòa', 'nt': 'Ninh Thuận',
    'gl': 'Gia Lai', 'kt': 'Kon Tum', 'ld': 'Lâm Đồng',
    'bp': 'Bình Phước', 'la': 'Long An', 'tg': 'Tiền Giang',
    'vl': 'Vĩnh Long', 'dt': 'Đồng Tháp', 'ag': 'An Giang',
    'kg': 'Kiên Giang', 'bl': 'Bạc Liêu', 'cm': 'Cà Mau',
    'st': 'Sóc Trăng', 'tv': 'Trà Vinh',
    'bd': 'Bình Dương', 'bt': 'Bình Thuận', 'dn': 'Đồng Nai',
    'dl': 'Đắk Lắk', 'tn': 'Thái Nguyên', 'hg': 'Hà Giang',
    'qn': 'Quảng Ninh', 'hn': 'Hà Nam'
};

const DISTRICT_SHORT_CODES = {
    'bc': 'Bến Cát', 'tu': 'Tân Uyên',
    'bh': 'Biên Hòa', 'lk': 'Long Khánh',
    'cg': 'Cần Giuộc', 'bl': 'Bến Lức', 'dh': 'Đức Hòa'
};

/**
 * Expand 2-letter province/district codes chỉ khi nằm ở vị trí phù hợp.
 *
 * Có dấu phẩy:
 *   - Segment cuối  → ưu tiên tỉnh, fallback huyện
 *   - Segment áp chót → ưu tiên huyện, fallback tỉnh
 *
 * Không có dấu phẩy:
 *   - Từ cuối cùng (cần >= 2 từ) → ưu tiên tỉnh, fallback huyện
 *
 * Segment > 3 từ bị bỏ qua (không thể là viết tắt đơn lẻ).
 */
function expandShortCodesAtEnd(address) {
    const hasCommas = address.includes(',');
    let changed = false;

    if (hasCommas) {
        const segments = address.split(',').map(s => s.trim()).filter(s => s);
        if (segments.length === 0) return address;

        // --- Segment cuối: tỉnh trước, huyện fallback ---
        const lastIdx = segments.length - 1;
        const lastWords = segments[lastIdx].split(/\s+/).filter(w => w);
        if (lastWords.length > 0 && lastWords.length <= 3) {
            const code = lastWords[lastWords.length - 1].toLowerCase();
            const expanded = PROVINCE_SHORT_CODES[code] || DISTRICT_SHORT_CODES[code];
            if (expanded) {
                const type = PROVINCE_SHORT_CODES[code] ? 'Province' : 'District';
                lastWords[lastWords.length - 1] = expanded;
                segments[lastIdx] = lastWords.join(' ');
                changed = true;
                console.log(`  ✓ ${type} code at end: "${code}" → "${expanded}"`);
            }
        }

        // --- Segment áp chót: huyện trước, tỉnh fallback ---
        if (segments.length >= 2) {
            const prevIdx = segments.length - 2;
            const prevWords = segments[prevIdx].split(/\s+/).filter(w => w);
            if (prevWords.length > 0 && prevWords.length <= 3) {
                const code = prevWords[prevWords.length - 1].toLowerCase();
                const expanded = DISTRICT_SHORT_CODES[code] || PROVINCE_SHORT_CODES[code];
                if (expanded) {
                    const type = DISTRICT_SHORT_CODES[code] ? 'District' : 'Province';
                    prevWords[prevWords.length - 1] = expanded;
                    segments[prevIdx] = prevWords.join(' ');
                    changed = true;
                    console.log(`  ✓ ${type} code at second-to-last: "${code}" → "${expanded}"`);
                }
            }
        }

        return changed ? segments.join(', ') : address;
    }

    // Không có dấu phẩy: chỉ kiểm tra từ cuối cùng
    const words = address.trim().split(/\s+/);
    if (words.length >= 2) {
        const code = words[words.length - 1].toLowerCase();
        const expanded = PROVINCE_SHORT_CODES[code] || DISTRICT_SHORT_CODES[code];
        if (expanded) {
            const type = PROVINCE_SHORT_CODES[code] ? 'Province' : 'District';
            words[words.length - 1] = expanded;
            changed = true;
            console.log(`  ✓ ${type} code as last word (no commas): "${code}" → "${expanded}"`);
        }
    }

    if (!changed) {
        console.log('  ⏭️ No position-appropriate short codes found');
    }

    return changed ? words.join(' ') : address;
}

// ============================================
// CUSTOMER ADDRESS HINT (từ lịch sử đơn hàng)
// ============================================
// Trích xuất tỉnh/phường phổ biến nhất của khách hàng từ dữ liệu đã load
// trong bộ nhớ (allOrdersData). Không gọi API → zero latency.

/**
 * Lấy tỉnh/phường phổ biến nhất của khách hàng từ dữ liệu đơn hàng đã load.
 * Trả về null nếu không tìm thấy hoặc dữ liệu chưa sẵn sàng.
 */
function getCustomerAddressHint(phone) {
    if (!phone || typeof allOrdersData === 'undefined' ||
        !Array.isArray(allOrdersData) || allOrdersData.length === 0) {
        return null;
    }

    const customerOrders = allOrdersData.filter(
        o => o.customer_phone === phone && o.province_id
    );
    if (customerOrders.length === 0) return null;

    // Đếm tần suất province_id
    const pCounts = {};
    for (const o of customerOrders) {
        const pid = String(o.province_id);
        pCounts[pid] = (pCounts[pid] || 0) + 1;
    }
    const topProvince = Object.entries(pCounts).sort((a, b) => b[1] - a[1])[0];
    if (!topProvince) return null;

    // Đếm tần suất ward_id trong tỉnh phổ biến nhất
    const wCounts = {};
    for (const o of customerOrders) {
        if (String(o.province_id) === topProvince[0] && o.ward_id) {
            const wid = String(o.ward_id);
            wCounts[wid] = (wCounts[wid] || 0) + 1;
        }
    }
    const topWard = Object.entries(wCounts).sort((a, b) => b[1] - a[1])[0];

    return {
        province_id: topProvince[0],
        ward_id: topWard ? topWard[0] : null,
        orderCount: customerOrders.length
    };
}

// ============================================
// PARSE ADDRESS v3 — 2-level (Tỉnh/TP → Phường/Xã)
// tree_2.json via addressSelector.data
// ============================================

let _provinceAliasMap = null;

function _resetParseAddrCache() {
    _provinceAliasMap = null;
}

function _nn(s) {
    return removeVietnameseTones(s || '').toLowerCase()
        .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _bare(name) {
    return _nn(name)
        .replace(/^(tinh|thanh pho|tp|quan|q|huyen|thi xa|tx|phuong|p|f|xa|thi tran|tt)\s+/, '')
        .trim();
}

function _bareNumericEqual(a, b) {
    if (!a || !b) return false;
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    return parseInt(a, 10) === parseInt(b, 10);
}

function _stripTrailingProvinceSuffix(seg, province) {
    if (!seg || !province) return seg;
    const sw = seg.trim().split(/\s+/).filter(Boolean);
    if (sw.length < 2) return seg;
    const pb = _bare(province.Name);
    if (!pb) return seg;
    for (let n = Math.min(3, sw.length - 1); n >= 1; n--) {
        const tail = sw.slice(-n).join(' ');
        if (_bare(tail) === pb) {
            const head = sw.slice(0, -n).join(' ').trim();
            return head || seg;
        }
    }
    return seg;
}

// Viết tắt tĩnh → chuỗi tìm trong tên tỉnh (đã bỏ dấu)
const _STATIC_PROV_ALIAS_KEYS = {
    'hcm': 'ho chi minh', 'tphcm': 'ho chi minh', 'tp hcm': 'ho chi minh', 'tp.hcm': 'ho chi minh',
    'sai gon': 'ho chi minh', 'saigon': 'ho chi minh', 'sg': 'ho chi minh',
    'hn': 'ha noi', 'ha noi': 'ha noi', 'hanoi': 'ha noi',
    'dn': 'da nang', 'da nang': 'da nang', 'danang': 'da nang',
    'dnai': 'dong nai', 'dong nai': 'dong nai',
    'hp': 'hai phong', 'hai phong': 'hai phong',
    'ct': 'can tho', 'can tho': 'can tho',
    'ag': 'an giang', 'an giang': 'an giang',
    'bg': 'bac giang', 'bac giang': 'bac giang',
    'bn': 'bac ninh', 'bac ninh': 'bac ninh',
    'bd': 'binh duong', 'binh duong': 'binh duong',
    'bp': 'binh phuoc', 'binh phuoc': 'binh phuoc',
    'bt': 'binh thuan', 'binh thuan': 'binh thuan',
    'brvt': 'ba ria', 'br vt': 'ba ria', 'vung tau': 'vung tau', 'br-vt': 'ba ria',
    'bl': 'bac lieu', 'bac lieu': 'bac lieu',
    'ben tre': 'ben tre',
    'cb': 'cao bang', 'cao bang': 'cao bang',
    'cm': 'ca mau', 'ca mau': 'ca mau',
    'db': 'dien bien', 'dien bien': 'dien bien',
    'dl': 'dak lak', 'daklak': 'dak lak', 'dac lac': 'dak lak',
    'dno': 'dak nong', 'dak nong': 'dak nong',
    'dt': 'dong thap', 'dong thap': 'dong thap',
    'gl': 'gia lai', 'gia lai': 'gia lai',
    'hb': 'hoa binh', 'hoa binh': 'hoa binh',
    'hag': 'ha giang', 'ha giang': 'ha giang',
    'hnam': 'ha nam', 'ha nam': 'ha nam',
    'ht': 'ha tinh', 'ha tinh': 'ha tinh',
    'hd': 'hai duong', 'hai duong': 'hai duong',
    'haug': 'hau giang', 'hau giang': 'hau giang',
    'hy': 'hung yen', 'hung yen': 'hung yen',
    'kh': 'khanh hoa', 'khanh hoa': 'khanh hoa',
    'kg': 'kien giang', 'kien giang': 'kien giang',
    'kt': 'kon tum', 'kon tum': 'kon tum',
    'lc': 'lao cai', 'lao cai': 'lao cai',
    'lb': 'lai chau', 'lai chau': 'lai chau',
    'ld': 'lam dong', 'lam dong': 'lam dong',
    'ls': 'lang son', 'lang son': 'lang son',
    'la': 'long an', 'long an': 'long an',
    'nd': 'nam dinh', 'nam dinh': 'nam dinh',
    'na': 'nghe an', 'nghe an': 'nghe an',
    'nb': 'ninh binh', 'ninh binh': 'ninh binh',
    'nt': 'ninh thuan', 'ninh thuan': 'ninh thuan',
    'pt': 'phu tho', 'phu tho': 'phu tho',
    'py': 'phu yen', 'phu yen': 'phu yen',
    'qb': 'quang binh', 'quang binh': 'quang binh',
    'qnam': 'quang nam', 'quang nam': 'quang nam',
    'qng': 'quang ngai', 'quang ngai': 'quang ngai',
    'qn': 'quang ninh', 'quang ninh': 'quang ninh',
    'qt': 'quang tri', 'quang tri': 'quang tri',
    'sl': 'son la', 'son la': 'son la',
    'st': 'soc trang', 'soc trang': 'soc trang',
    'tn': 'thai nguyen', 'thai nguyen': 'thai nguyen',
    'tb': 'thai binh', 'thai binh': 'thai binh',
    'th': 'thanh hoa', 'thanh hoa': 'thanh hoa',
    'tth': 'hue', 'thua thien hue': 'hue', 'hue': 'hue',
    'tg': 'tien giang', 'tien giang': 'tien giang',
    'tninh': 'tay ninh', 'tay ninh': 'tay ninh',
    'tv': 'tra vinh', 'tra vinh': 'tra vinh',
    'tq': 'tuyen quang', 'tuyen quang': 'tuyen quang',
    'vl': 'vinh long', 'vinh long': 'vinh long',
    'vp': 'vinh phuc', 'vinh phuc': 'vinh phuc',
    'yb': 'yen bai', 'yen bai': 'yen bai',
    'bdinh': 'binh dinh', 'binh dinh': 'binh dinh',
};

// Viết tắt quận/huyện cũ → tên lõi (nhiều tên quận cũ trùng phường/xã mới)
const _LEGACY_AREA_HINTS = {
    'g/vap': 'go vap', 'b/thanh': 'binh thanh', 'b/th': 'binh thanh',
    't/duc': 'thu duc', 'b/chanh': 'binh chanh', 'h/mon': 'hoc mon',
    'c/gio': 'can gio', 'p/nhuan': 'phu nhuan', 'b/t': 'binh tan', 'b/tan': 'binh tan',
    'tdm': 'thu dau mot', 'bmt': 'buon ma thuot',
};

const _CENTRAL_PROV_IDS = new Set(['01', '30', '12', '05', '32']);
const _LEGACY_HCM_BARE = new Set([
    'go vap', 'binh thanh', 'thu duc', 'binh chanh', 'hoc mon', 'can gio',
    'phu nhuan', 'binh tan', 'thu dau mot', 'binh duong', 'phu loi', 'ba ria',
    'vung tau', 'phu my', 'quan 1', 'quan 2', 'quan 3', 'quan 4', 'quan 5',
    'quan 6', 'quan 7', 'quan 8', 'quan 9', 'quan 10', 'quan 11', 'quan 12',
]);

const _NOISE_RE = /\b(noi dai|keo dai|mo rong|viet nam|vietnam|n\u1ed1i d\u00e0i|k\u00e9o d\u00e0i|m\u1edf r\u1ed9ng)\b/gi;
const _SUBWARD_RE = /\b(\u1ea5p|\u1ea1p|ap|x\u00f3m|xom|th\u00f4n|thon|t\u1ed5 d\u00e2n ph\u1ed1|to dan pho|t\u1ed5|to|kh\u00f3m|khom|khu ph\u1ed1|khu pho|tdp|ng\u00f5|ngo|h\u1ebem|hem)\s+(\d[\w/]*)\b/gi;

/** JS \b chỉ ASCII — trong "ấp" có ranh giới ấ|p, tránh expand "p 5" → "Phường 5". */
const _UNI_LETTER = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/;

function _expandPfNumber(m, num, offset, str) {
    if (arguments.length === 5) {
        num = arguments[2];
        offset = arguments[3];
        str = arguments[4];
    }
    if (offset > 0 && _UNI_LETTER.test(str[offset - 1])) return m;
    return 'Ph\u01b0\u1eddng ' + num;
}

function _expandQNumber(m, num, offset, str) {
    if (offset > 0 && _UNI_LETTER.test(str[offset - 1])) return m;
    return 'Qu\u1eadn ' + num;
}

function _findProvinceByWardNeedle(needle, data) {
    const cn = _nn(needle);
    if (!cn) return null;
    const matches = [];
    for (const prov of data) {
        for (const ward of (prov.Wards || [])) {
            for (const label of _wardLabels(ward)) {
                const score = _scoreItemMatch(cn, _bare(label));
                if (score >= 0.88) matches.push({ province: prov, score });
            }
        }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (_CENTRAL_PROV_IDS.has(b.province.Id) ? 1 : 0) - (_CENTRAL_PROV_IDS.has(a.province.Id) ? 1 : 0);
    });
    return matches[0].province;
}

function _buildProvinceAliasMap(data) {
    if (_provinceAliasMap) return _provinceAliasMap;
    const map = new Map();
    const add = (key, prov) => {
        const k = _nn(key);
        if (k && k.length >= 1 && !map.has(k)) map.set(k, prov);
    };
    const provMatchesNeedle = (prov, needle) => {
        const pn = _nn(prov.Name);
        const pb = _bare(prov.Name);
        return pn.includes(needle) || pb.includes(needle) || needle.includes(pb);
    };
    for (const prov of data) {
        add(prov.Name, prov);
        add(_bare(prov.Name), prov);
        const short = prov.Name.replace(/^(Thành phố|Tỉnh)\s+/i, '');
        add(short, prov);
        add(_bare(short), prov);
    }
  for (const [alias, needle] of Object.entries(_STATIC_PROV_ALIAS_KEYS)) {
        let found = null;
        for (const prov of data) {
            if (provMatchesNeedle(prov, needle)) { found = prov; break; }
        }
        // Không dùng _findProvinceByWardNeedle: "nam dinh" → Phường Nam Định (Ninh Bình)
        // sẽ bị _expand thay thành tên tỉnh và phá anchor phường/xã.
        if (found) add(alias, found);
    }
    _provinceAliasMap = map;
    return map;
}

function _wardLabels(ward) {
    const labels = [ward.Name];
    if (ward.ShortName) labels.push(ward.ShortName);
    return labels;
}

function _scoreItemMatch(cn, iN) {
    if (cn === iN || _bareNumericEqual(cn, iN)) return 1;
    if (cn.length >= 2 && iN.includes(cn)) return cn.length / iN.length * 0.95;
    if (iN.length >= 2 && cn.includes(iN)) return iN.length / cn.length * 0.90;

    // Đa từ: từ cuối khác nhau rõ (vd "dong cao" ≠ "dong da") → không cho fuzzy cao
    const ct = cn.split(/\s+/).filter(Boolean);
    const it = iN.replace(/^(phuong|xa|thi tran|tt|p|f)\s+/i, '').split(/\s+/).filter(Boolean);
    if (ct.length >= 2 && it.length >= 2) {
        const lastC = ct[ct.length - 1];
        const lastI = it[it.length - 1];
        if (lastC.length >= 2 && lastI.length >= 2) {
            const lastMax = Math.max(lastC.length, lastI.length);
            const lastSim = 1 - levenshteinDistance(lastC, lastI) / lastMax;
            if (lastSim < 0.8) return Math.min(0.55, lastSim);
        }
    }

    const maxL = Math.max(cn.length, iN.length);
    if (Math.abs(cn.length - iN.length) <= maxL * 0.5) {
        return 1 - levenshteinDistance(cn, iN) / maxL;
    }
    return 0;
}

function _sameBareAsProvince(seg, province) {
    return !!(province && seg && _bare(seg) === _bare(province.Name));
}

/** Từ đơn lẻ trùng một phần tên tỉnh (vd "Bình" trong "Ninh Bình") — không dùng để khớp phường. */
function _isProvinceNameFragment(seg, province) {
    if (!seg || !province) return false;
    if (_sameBareAsProvince(seg, province)) return true;
    const sb = _bare(seg);
    if (!sb || sb.length < 2) return false;
    return _bare(province.Name).split(/\s+/).some(function (p) {
        return p.length >= 2 && p === sb;
    });
}

/** Bật log chi tiết trong DevTools: window.ADDR_PARSE_DEBUG = true */
function _addrDbg(step, detail) {
    if (typeof window !== 'undefined' && window.ADDR_PARSE_DEBUG) {
        console.log('[parseAddress:v3]', step, detail);
    }
}

function _matchWard(cand, wards, thr, province) {
    if (!cand || !wards?.length) return null;
    const cn = _bare(cand);
    if (!cn || /^\d+$/.test(cn)) return null;
    if (province && _sameBareAsProvince(cand, province)) {
        _addrDbg('skip ward (same as province name)', { cand, province: province.Name });
        return null;
    }
    if (province && _isProvinceNameFragment(cand, province)) {
        _addrDbg('skip ward (province name fragment)', { cand, province: province.Name });
        return null;
    }
    let best = null, bScore = 0;
    const top = [];
    for (const ward of wards) {
        for (const label of _wardLabels(ward)) {
            const iN = _bare(label);
            const score = _scoreItemMatch(cn, iN);
            if (score >= thr - 0.05) top.push({ ward: ward.Name, label, score: +score.toFixed(3) });
            if (score > bScore && score >= thr) { best = ward; bScore = score; }
        }
    }
    if (typeof window !== 'undefined' && window.ADDR_PARSE_DEBUG && top.length) {
        top.sort(function (a, b) { return b.score - a.score; });
        _addrDbg('matchWard', { cand, thr, top: top.slice(0, 5), picked: best ? best.Name : null });
    }
    return best;
}

function _globalWard(cand, data, province, thr) {
    if (!cand) return null;
    const cn = _bare(cand);
    if (!cn || /^\d+$/.test(cn)) return null;

    const hcm = province?.Id === '30' ? province : data.find(function (p) { return p.Id === '30'; });
    if (hcm && _LEGACY_HCM_BARE.has(cn)) {
        const w = _matchWard(cand, hcm.Wards, thr, hcm);
        if (w) return { ward: w, province: hcm };
    }

    const matches = [];
    for (const prov of (province ? [province] : data)) {
        for (const ward of (prov.Wards || [])) {
            for (const label of _wardLabels(ward)) {
                const score = _scoreItemMatch(cn, _bare(label));
                if (score >= thr) matches.push({ ward, province: prov, score });
            }
        }
    }
    if (!matches.length) return null;
    matches.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return (_CENTRAL_PROV_IDS.has(b.province.Id) ? 1 : 0) - (_CENTRAL_PROV_IDS.has(a.province.Id) ? 1 : 0);
    });
    return { ward: matches[0].ward, province: matches[0].province };
}

function _findWardByHint(hint, data, province, thr) {
    if (!hint) return null;
    if (province) {
        const w = _matchWard(hint, province.Wards, thr, province);
        if (w) return { ward: w, province };
    }
    return _globalWard(hint, data, province, thr);
}

function _extractLegacyAreaHints(text) {
    const hints = [];
    text.replace(/\b([\w\u00C0-\u024F\u1E00-\u1EFF]+)\/([\w\u00C0-\u024F\u1E00-\u1EFF]+)\b/g, function (m) {
        const k = _nn(m).replace(/\s/g, '/');
        const mapped = _LEGACY_AREA_HINTS[k] || _LEGACY_AREA_HINTS[m.toLowerCase()];
        if (mapped) hints.push(mapped);
        return m;
    });
    for (const abbr of Object.keys(_LEGACY_AREA_HINTS)) {
        if (abbr.includes('/')) continue;
        const escaped = abbr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'gi');
        if (re.test(text)) hints.push(_LEGACY_AREA_HINTS[abbr]);
    }
    return hints;
}

function _expand(text, data) {
    _buildProvinceAliasMap(data);
    text = text.normalize('NFC').replace(/\u00A0/g, ' ');
    text = text.replace(/,(\S)/g, ', $1');
    text = text.replace(/\s*[-\u2013\u2014|]\s*/g, ', ');
    text = text.replace(/([A-Za-z\u00C0-\u024F\u1E00-\u1EFF]{3,})\.\s*([A-Za-z\u00C0-\u024F\u1E00-\u1EFF])/g, '$1, $2');

    text = text.replace(/\b([PF])\.?(\d{1,2})(?=[qQ]\.?\d{1,2}\b)/gi, function (m, _p, n, offset, str) {
        return _expandPfNumber(m, n, offset, str) + ' ';
    });
    text = text.replace(/\bQ\.?\s*(\d{1,2})\b/gi, _expandQNumber);
    text = text.replace(/\b[PF]\.?\s*(\d{1,2})\b/gi, _expandPfNumber);

    // TP HCM → HCM (tránh "TP Thành phố Hồ Chí Minh" sau expand alias)
    text = text.replace(
        /\b(?:tp\.?|th\u00e0nh ph\u1ed1|thanh pho)\s+(hcm|tphcm|sg|sai\s*gon|saigon)\b/gi,
        '$1'
    );
    text = text.replace(/\b[pP]\.\s?([A-Z][a-zA-Z\u00C0-\u024F]*(?:\s+[A-Z][a-zA-Z\u00C0-\u024F]*){0,2})\b/g,
        'Ph\u01b0\u1eddng $1');

    const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
    text = text.replace(/\b(ph\u01b0\u1eddng|phuong)\s+(x{0,1}i{0,3}|i?x|v?i{0,3})\b/gi, function (m, kw, rn) {
        const n = ROMAN[rn.toLowerCase()];
        return n ? kw + ' ' + n : m;
    });

    text = text.replace(_NOISE_RE, ' ');
    text = text.replace(/\b\d{5,6}\b/g, ' ');

    const aliasMap = _buildProvinceAliasMap(data);
    const tokens = text.split(/\s+/);
    const protectedIdx = new Set();
    for (let j = 0; j < tokens.length - 1; j++) {
        const tk = tokens[j].replace(/[,;.:]+$/g, '');
        if (/^(tinh|t\u1ec9nh)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(3, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
        if (/^(phuong|ph\u01b0\u1eddng|xa|x\u00e3|thi tran|th\u1ecb tr\u1ea5n|tt)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(2, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
        if (/^(\u1ea5p|\u1ea1p|ap|x\u00f3m|xom|th\u00f4n|thon|khu ph\u1ed1|khu pho|tdp|ng\u00f5|ngo)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(2, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
    }
    const out = [];
    let i = 0;
    while (i < tokens.length) {
        let matched = false;
        if (!protectedIdx.has(i)) {
            for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
                if (n > 1 && tokens.slice(i, i + n - 1).some(function (t) { return t.indexOf(',') !== -1; })) continue;
                if (tokens.slice(i, i + n).some(function (_, off) { return protectedIdx.has(i + off); })) continue;
                const key = _nn(tokens.slice(i, i + n).join(' '));
                if (/^\d+$/.test(key)) continue;
                const prov = aliasMap.get(key);
                if (prov) {
                    out.push(prov.Name);
                    i += n;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) { out.push(tokens[i]); i++; }
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
}

function _extractSubward(text) {
    const parts = [];
    const cleaned = text.replace(_SUBWARD_RE, function (m) { parts.push(m.trim()); return ' '; })
        .replace(/\s+/g, ' ').trim();
    return { cleaned, subward: parts.join(', ') };
}

var _ADMIN_LA = '(?='
    + '\\s*(?:$|[,.])'
    + '|\\s+(?:'
    + 'tinh|t\u1ec9nh'
    + '|thanh\\s+pho|th\u00e0nh\\s+ph\u1ed1|tp\\.?'
    + '|quan|qu\u1eadn'
    + '|huyen|huy\u1ec7n'
    + '|thi\\s+xa|th\u1ecb\\s+x\u00e3|tx\\.?'
    + '|phuong|ph\u01b0\u1eddng'
    + '|xa|x\u00e3'
    + '|thi\\s+tran|th\u1ecb\\s+tr\u1ea5n|tt\\.?'
    + ')(?:\\s|$|[,.])'
    + ')';

function _anchors(text) {
    const a = { province: null, legacy: [], ward: null };
    let m;

    var reP = new RegExp('(?:^|[,.]\\s*)(?:t\u1ec9nh|tinh)\\s+([^,\\n]{1,30}?)' + _ADMIN_LA, 'gi');
    reP.lastIndex = 0;
    while ((m = reP.exec(text))) a.province = m[1].trim();
    if (!a.province) {
        var rePEnd = /\b(?:t\u1ec9nh|tinh)\s+([^,\n]{1,30}?)\s*$/i;
        m = rePEnd.exec(text);
        if (m) a.province = m[1].trim();
    }

    const tpCands = [];
    var reTP = new RegExp('\\b(?:th\u00e0nh\\s+ph\u1ed1|thanh\\s+pho|tp\\.?)\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reTP.lastIndex = 0;
    while ((m = reTP.exec(text))) tpCands.push(m[1].trim().split(/\s*,/)[0].trim());

    var reD = new RegExp('\\b(?:qu\u1eadn|quan|huy\u1ec7n|huyen|th\u1ecb\\s+x\u00e3|thi\\s+xa|tx\\.?)\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reD.lastIndex = 0;
    while ((m = reD.exec(text))) a.legacy.push(m[1].trim().split(/\s*,/)[0].trim());

    var reW = new RegExp('\\b(?:ph\u01b0\u1eddng|phuong|th\u1ecb\\s+tr\u1ea5n|thi\\s+tran|tt\\.?|(?<!\\bthi\\s)(?<!\\bth\u1ecb\\s)(?:x\u00e3|xa))\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reW.lastIndex = 0;
    while ((m = reW.exec(text))) {
        if (a.ward) break;
        let wText = m[1].trim().split(/\s*,/)[0].trim();
        const wWords = wText.split(/\s+/);
        if (wWords.length > 3) wText = wWords.slice(0, 2).join(' ');
        if (/^\d+$/.test(wWords[0]) && wWords.length > 1) {
            a.legacy.push(wWords.slice(1).join(' '));
        } else if (!/^\d+$/.test(_bare(wText))) {
            a.ward = wText;
        }
    }

    const centralCities = new Set(['ho chi minh', 'ha noi', 'da nang', 'hai phong', 'can tho', 'hue']);
    for (const cand of tpCands) {
        if (centralCities.has(_bare(cand))) a.province = cand;
        else a.legacy.push(cand);
    }
    return a;
}

function _match(cand, items, thr) {
    if (!cand || !items?.length) return null;
    const cn = _bare(cand);
    if (!cn) return null;
    let best = null, bScore = 0;
    for (const item of items) {
        const score = _scoreItemMatch(cn, _bare(item.Name));
        if (score > bScore && score >= thr) { best = item; bScore = score; }
    }
    return best;
}

var _provFromEndText = null;
function _inferProvFromEnd(text, data, thr) {
    _provFromEndText = null;
    const aliasMap = _buildProvinceAliasMap(data);
    let words = text.split(/[\s,]+/).filter(function (w) { return w.length > 1; });
    // Bỏ badge số đuôi (vd "09") trước khi lấy tỉnh cuối chuỗi
    while (words.length > 1 && /^\d{1,2}$/.test(words[words.length - 1])) {
        words = words.slice(0, -1);
    }
    // Peel tên người dính sau tỉnh (vd "... Hà Nội Nguyễn Văn Yên")
    for (let peel = 0; peel <= Math.min(4, Math.max(0, words.length - 1)); peel++) {
        const use = words.slice(0, words.length - peel);
        for (let n = Math.min(3, use.length); n >= 1; n--) {
            const candidate = use.slice(-n).join(' ');
            const fromAlias = aliasMap.get(_nn(candidate));
            if (fromAlias) {
                _provFromEndText = candidate;
                return fromAlias;
            }
            const p = _match(candidate, data, thr);
            if (p) {
                _provFromEndText = candidate;
                return p;
            }
            const fromWard = _findProvinceByWardNeedle(candidate, data);
            if (fromWard) {
                _provFromEndText = candidate;
                return fromWard;
            }
        }
    }
    return null;
}

function _collectLegacyHints(anc, rawText) {
    const primary = anc.ward ? [anc.ward] : [];
    const secondary = [];
    if (anc.legacy?.length) secondary.push(...anc.legacy);
    if (rawText) secondary.push(..._extractLegacyAreaHints(rawText));
    const uniqueSecondary = [...new Set(secondary.filter(Boolean))];
    uniqueSecondary.sort(function (a, b) {
        const ba = _bare(a), bb = _bare(b);
        const aNum = /^\d+$/.test(ba) ? 1 : 0;
        const bNum = /^\d+$/.test(bb) ? 1 : 0;
        if (aNum !== bNum) return aNum - bNum;
        return bb.length - ba.length;
    });
    return [...primary, ...uniqueSecondary.filter(function (h) { return !primary.includes(h); })];
}

function _fallback2(text, data) {
    const out = { province: null, ward: null };
    const segs = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    if (segs.length >= 2) {
        for (let pi = segs.length - 1; pi >= 0; pi--) {
            const p = _match(segs[pi], data, 0.80);
            if (!p) continue;
            out.province = p;
            for (let wi = pi - 1; wi >= 0; wi--) {
                if (_isProvinceNameFragment(segs[wi], p)) continue;
                const w = _matchWard(_stripTrailingProvinceSuffix(segs[wi], p), p.Wards, 0.73, p);
                if (w) { out.ward = w; break; }
            }
            return out;
        }
    }

    // Tách cả dấu phẩy — tránh ghép xuyên segment (vd "linh, Thành" → Vĩnh Thanh)
    const words = text.split(/[\s,]+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (let s = words.length - n; s >= 0; s--) {
            const p = _match(words.slice(s, s + n).join(' '), data, 0.82);
            if (!p) continue;
            out.province = p;
            const rem = words.slice(0, s).concat(words.slice(s + n));
            for (let wn = Math.min(3, rem.length); wn >= 1; wn--) {
                for (let ws = rem.length - wn; ws >= 0; ws--) {
                    const cand = rem.slice(ws, ws + wn).join(' ');
                    if (_WARD_SCAN_SKIP_TOKENS.has(_nn(cand))) continue;
                    if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && wn >= 2) continue;
                    if (_isProvinceNameFragment(cand, p)) continue;
                    const w = _matchWard(
                        _stripTrailingProvinceSuffix(cand, p),
                        p.Wards, 0.75, p
                    );
                    if (w) { out.ward = w; return out; }
                }
            }
            return out;
        }
    }

    for (let wn = Math.min(3, words.length); wn >= 1; wn--) {
        for (let ws = words.length - wn; ws >= 0; ws--) {
            const cand = words.slice(ws, ws + wn).join(' ');
            if (_WARD_SCAN_SKIP_TOKENS.has(_nn(cand))) continue;
            if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && wn >= 2) continue;
            const r = _globalWard(cand, data, null, 0.78);
            if (r) { out.ward = r.ward; out.province = r.province; return out; }
        }
    }
    return out;
}

function _partialWardFallback(text, province, hints) {
    for (const hint of hints) {
        const w = _matchWard(hint, province.Wards, 0.73, province);
        if (w) return w;
    }
    const segs = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (let si = segs.length - 1; si >= 0; si--) {
        if (_isProvinceNameFragment(segs[si], province)) continue;
        const w = _matchWard(_stripTrailingProvinceSuffix(segs[si], province), province.Wards, 0.73, province);
        if (w) return w;
    }
    // Tách cả dấu phẩy — tránh ghép xuyên segment (vd "Cao, Thành" → Đại Thanh)
    const words = text.split(/[\s,]+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (let i = words.length - n; i >= 0; i--) {
            const cand = words.slice(i, i + n).join(' ');
            if (_isProvinceNameFragment(cand, province)) continue;
            if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && n >= 2) continue;
            const w = _matchWard(_stripTrailingProvinceSuffix(cand, province), province.Wards, 0.75, province);
            if (w) return w;
        }
    }
    return null;
}

// So sánh 2 ứng viên phường: exact thắng fuzzy; trong exact ưu tiên có keyword "phường/xã",
// rồi window dài hơn (khớp nhiều chữ hơn), rồi gần cuối (sát tỉnh) hơn.
function _betterWardCand(a, b) {
    if (!b) return true;
    if (a.exact !== b.exact) return a.exact > b.exact;
    if (a.exact) {
        if (a.kw !== b.kw) return a.kw > b.kw;
        if (a.len !== b.len) return a.len > b.len;
        return a.pos > b.pos;
    }
    if (Math.abs(a.score - b.score) > 0.03) return a.score > b.score;
    if (a.kw !== b.kw) return a.kw > b.kw;
    if (a.len !== b.len) return a.len > b.len;
    return a.pos > b.pos;
}

const _WARD_KW = new Set(['phuong', 'p', 'f', 'xa', 'x', 'thi tran', 'tt', 'tdp', 'kp', 'khu pho', 'khom', 'ap']);
/** Token hành chính / mảnh tên tỉnh — không dùng làm ứng viên phường đơn lẻ */
const _WARD_SCAN_SKIP_TOKENS = new Set([
    'thanh', 'pho', 'tinh', 'tp', 'quan', 'huyen', 'thi', 'xa', 'phuong', 'p', 'f', 'tt',
    'thanh pho', 'thi xa', 'thi tran',
]);

/**
 * Ưu tiên tuyệt đối: tên phường/xã xuất hiện nguyên cụm trong text (vd "mê linh").
 * Tránh fuzzy "Đông Cao"→Đống Đa / nhiễu "Thành"→Vĩnh Thanh.
 */
function _findExactWardMention(text, province) {
    if (!province?.Wards?.length || !text) return null;
    const hay = ` ${_nn(text)} `;
    let best = null;
    for (const ward of province.Wards) {
        for (const label of _wardLabels(ward)) {
            const bare = _bare(label);
            if (!bare || bare.length < 3) continue;
            const needle = ` ${bare} `;
            if (!hay.includes(needle)) continue;
            const len = bare.split(/\s+/).filter(Boolean).length;
            if (!best || len > best.len) best = { ward, len, bare };
        }
    }
    return best ? best.ward : null;
}

/**
 * Quét toàn chuỗi tìm phường/xã khớp tốt nhất TRONG MỘT TỈNH.
 * Bỏ qua dấu phẩy (chạy cả khi không có dấu ngăn cách), window 1..4 từ,
 * ưu tiên khớp CHÍNH XÁC (không return sớm ở window fuzzy nhiễu).
 * Trả về { ward, exact, score } hoặc null.
 */
function _bestWardInProvince(text, province) {
    if (!province || !province.Wards || !province.Wards.length || !text) return null;
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const toks = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const bare = _nn(rawTokens[i]);
        if (!bare) continue;
        if (_WARD_SCAN_SKIP_TOKENS.has(bare)) continue;
        const prev = i > 0 ? _nn(rawTokens[i - 1]) : '';
        let afterKw = _WARD_KW.has(prev);
        // "thị xã" là huyện cũ (không phải phường) → không tính là keyword phường/xã
        if (afterKw && (prev === 'xa' || prev === 'x')) {
            const prev2 = i > 1 ? _nn(rawTokens[i - 2]) : '';
            if (prev2 === 'thi') afterKw = false;
        }
        toks.push({ bare, afterKw });
    }
    const N = toks.length;
    if (!N) return null;
    const maxW = Math.min(4, N);
    let best = null;
    for (let n = 1; n <= maxW; n++) {
        for (let i = 0; i + n <= N; i++) {
            const cand = toks.slice(i, i + n).map(t => t.bare).join(' ');
            if (!cand || /^\d+$/.test(cand)) continue;
            if (_WARD_SCAN_SKIP_TOKENS.has(cand)) continue;
            if (_isProvinceNameFragment(cand, province)) continue;
            let wWard = null, wScore = 0;
            for (const ward of province.Wards) {
                for (const label of _wardLabels(ward)) {
                    const s = _scoreItemMatch(cand, _bare(label));
                    if (s > wScore) { wScore = s; wWard = ward; }
                }
            }
            if (!wWard) continue;
            const exact = wScore >= 0.999 ? 1 : 0;
            if (!exact && wScore < 0.80) continue;
            const cur = { ward: wWard, score: wScore, len: n, pos: i, kw: toks[i].afterKw ? 1 : 0, exact };
            if (_betterWardCand(cur, best)) best = cur;
        }
    }
    return best ? { ward: best.ward, exact: best.exact === 1, score: best.score } : null;
}

function _extractStreet(expanded, province, ward, subward) {
    let s = expanded;
    s = s.replace(/\b(?:t\u1ec9nh|tinh)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:th\u00e0nh ph\u1ed1|thanh pho|tp\.?)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:qu\u1eadn|quan|huy\u1ec7n|huyen|th\u1ecb x\u00e3|thi xa|tx\.?)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:ph\u01b0\u1eddng|phuong|x\u00e3|xa|th\u1ecb tr\u1ea5n|thi tran|tt\.?)\s+[^,]+/gi, ' ');
    function safe(n) { return n ? n.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') : ''; }
    if (province) s = s.replace(new RegExp(safe(province.Name), 'gi'), ' ');
    if (ward) {
        s = s.replace(new RegExp(safe(ward.Name), 'gi'), ' ');
        if (ward.ShortName) s = s.replace(new RegExp(safe(ward.ShortName), 'gi'), ' ');
    }
    if (subward) s = s.replace(_SUBWARD_RE, ' ');
    s = s.replace(/\b[QPF]\.\s*/gi, ' ');
    s = s.replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').replace(/,\s*,+/g, ',').replace(/\s+/g, ' ').trim();
    return subward ? subward + (s ? ', ' + s : '') : s;
}

/**
 * parseAddress v3 — 2-level cascade (Tỉnh/TP → Phường/Xã)
 */
async function parseAddress(addressText, customerHint) {
    if (customerHint === undefined) customerHint = null;
    const result = { street: '', ward: null, district: null, province: null, confidence: 'low', suggestions: [], warnings: [] };
    const data = getVietnamAddressData();
    if (!data?.length || !addressText?.trim()) return result;

    _buildProvinceAliasMap(data);

    const expanded = _expand(addressText, data);
    const sw = _extractSubward(expanded);
    const cleaned = sw.cleaned;
    const subward = sw.subward;
    const anc = _anchors(cleaned);
    const legacyHints = _collectLegacyHints(anc, addressText);

    let province = null;
    let ward = null;

    if (anc.province) {
        const provNn = _nn(anc.province);
        if (/^(quan|huyen|thi xa|tx|phuong|xa|thi tran|tt)\s/.test(provNn) || /\//.test(anc.province)) {
            legacyHints.unshift(anc.province.replace(/^\S+\s+/, '').replace(/^[^/]+\//, ''));
            if (/\//.test(anc.province)) legacyHints.unshift(_LEGACY_AREA_HINTS[_nn(anc.province).replace(/\s/g, '/')] || _bare(anc.province));
            anc.province = null;
        } else {
            province = _match(anc.province, data, 0.78)
                || _buildProvinceAliasMap(data).get(_nn(anc.province))
                || _findProvinceByWardNeedle(anc.province, data);
            if (!province) legacyHints.unshift(anc.province);
        }
    }
    if (!province) province = _inferProvFromEnd(cleaned, data, 0.88);

    _addrDbg('1-normalize', { input: addressText, expanded, cleaned, anchors: anc, legacyHints });

    // Ưu tiên: tên xã/phường có nguyên văn trong địa chỉ (vd "mê linh") — chặn fuzzy nhiễu
    if (province && !ward) {
        ward = _findExactWardMention(cleaned, province) || _findExactWardMention(addressText, province);
        if (ward) _addrDbg('1a-exact-mention', { ward: ward.Name });
    }

    // Chỉ khớp anc.province như phường khi KHÔNG phải tên tỉnh (vd "Long An" trong Tây Ninh — OK; "Ninh Bình" — không)
    if (province && anc.province && !ward
        && _bare(anc.province) !== _bare(province.Name)
        && !_isProvinceNameFragment(anc.province, province)) {
        ward = _matchWard(anc.province, province.Wards, 0.78, province);
        _addrDbg('1b-province-anchor-as-ward', { ancProvince: anc.province, ward: ward?.Name || null });
    }

    const explicitProvinceName = anc.province ? _nn(anc.province) : '';
    for (const hint of legacyHints) {
        if (ward) break;
        if (explicitProvinceName && _nn(hint) === explicitProvinceName) {
            _addrDbg('2-hint-skip (same as province name)', hint);
            continue;
        }
        if (province && _sameBareAsProvince(hint, province)) {
            _addrDbg('2-hint-skip (bare province name)', hint);
            continue;
        }
        const r = _findWardByHint(hint, data, province, 0.75);
        _addrDbg('2-hint-try', { hint, province: province?.Name, result: r?.ward?.Name || null });
        if (r) {
            ward = r.ward;
            if (!province) province = r.province;
        }
    }

    // Quét khớp CHÍNH XÁC tên phường/xã trong tỉnh (ưu tiên hơn fuzzy/anchor) —
    // xử lý đúng địa chỉ mới 2 cấp kể cả khi không có dấu phẩy / không có chữ "phường".
    if (province) {
        // Bỏ tên tỉnh + tiền tố hành chính lẻ trước khi quét, tránh ghép xuyên biên
        // (vd "Long An" + "Tỉnh" → "An Tịnh"; "Nam Phước" + "Thành phố" → "Phước Thành").
        const safeProv = province.Name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const scanText = cleaned
            .replace(new RegExp(safeProv, 'gi'), ' ')
            .replace(/\b(?:t\u1ec9nh|tinh|th\u00e0nh ph\u1ed1|thanh pho|tp)\b/gi, ' ');
        const sc = _bestWardInProvince(scanText, province);
        if (sc && (sc.exact || !ward)) {
            ward = sc.ward;
            _addrDbg('2b-exact-scan', { ward: ward.Name, exact: sc.exact, score: sc.score });
        }
    }

    if (!province && !ward) {
        const fb = _fallback2(cleaned, data);
        province = fb.province;
        ward = fb.ward;
        _addrDbg('3-fallback2', { province: province?.Name, ward: ward?.Name });
    } else if (province && !ward) {
        ward = _partialWardFallback(cleaned, province, legacyHints);
        _addrDbg('4-partialWardFallback', { ward: ward?.Name });
    }

    if (province && !ward && _provFromEndText) {
        const alt = _partialWardFallback(cleaned, province, [_provFromEndText, ...legacyHints]);
        if (alt) ward = alt;
        _addrDbg('5-provFromEndFallback', { ward: ward?.Name });
    }

    if (!province && customerHint?.province_id) {
        province = data.find(function (p) { return p.Id === String(customerHint.province_id); }) || null;
    }
    if (province && !ward && customerHint?.ward_id) {
        ward = (province.Wards || []).find(function (w) { return w.Id === String(customerHint.ward_id); }) || null;
    }

    result.street = _extractStreet(expanded, province, ward, subward);
    result.province = province;
    result.ward = ward;
    result.confidence = province && ward ? 'high' : province ? 'medium' : 'low';

    console.log(
        '\uD83D\uDCCD parseAddress v3:',
        (province ? province.Name : '(none)') + ' \u2192 ' +
        (ward ? ward.Name + ' [' + ward.Id + ']' : '(no ward)') +
        ' | street: ' + (result.street || '(empty)') +
        ' | ' + result.confidence
    );
    _addrDbg('6-final', {
        province: province?.Name,
        ward: ward?.Name,
        wardId: ward?.Id,
        confidence: result.confidence
    });
    return result;
}


async function smartParseCustomerInfo(text) {
    if (!text || !text.trim()) {
        return {
            success: false,
            error: 'Không có dữ liệu để phân tích'
        };
    }

    // Normalize phone number separators: 0984.923.405 → 0984923405, 0984-923-405 → 0984923405
    // Run twice to handle patterns where matches are adjacent (e.g. 3 groups)
    text = text
        .replace(/(\d)[.\- ](\d)/g, '$1$2')
        .replace(/(\d)[.\- ](\d)/g, '$1$2');
    
    // Ensure addressSelector is loaded (it should be loaded when modal opens)
    if (!window.addressSelector || !window.addressSelector.loaded) {
        console.log('⏳ Waiting for addressSelector to load...');
        // Wait up to 2 seconds
        let attempts = 0;
        while ((!window.addressSelector || !window.addressSelector.loaded) && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.addressSelector || !window.addressSelector.loaded) {
            return {
                success: false,
                error: 'Không thể tải dữ liệu địa chỉ. Vui lòng thử lại.'
            };
        }
    }
    
    console.log('✅ AddressSelector ready with', window.addressSelector.data.length, 'provinces');
    
    // Split into lines and clean
    const lines = text
        .split(/[\n\r]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (lines.length === 0) {
        return {
            success: false,
            error: 'Không có dữ liệu hợp lệ'
        };
    }
    
    // Extract phone
    const phoneInfo = extractPhoneNumber(text);
    
    // Customer address hint: zero-cost lookup từ dữ liệu đã load trong bộ nhớ
    const customerHint = phoneInfo?.phone ? getCustomerAddressHint(phoneInfo.phone) : null;
    if (customerHint) {
        console.log(`🧑 Customer hint found: province=${customerHint.province_id}, ward=${customerHint.ward_id} (${customerHint.orderCount} đơn)`);
    }
    
    // Extract name
    const nameInfo = extractCustomerName(lines, phoneInfo);
    
    // Extract address (all lines except phone and name)
    // IMPROVED: Remove phone from line instead of removing entire line
    let addressLines = lines
        .filter(line => {
            // Skip if this line is ONLY the name
            if (nameInfo && line === nameInfo.name) return false;
            return true;
        })
        .map(line => {
            // Remove phone number from line if present
            // Also check phoneInfo.original for 9-digit fallback case (missing leading 0)
            const phoneMatch = phoneInfo && (
                line.includes(phoneInfo.phone) ? phoneInfo.phone :
                (phoneInfo.original && line.includes(phoneInfo.original)) ? phoneInfo.original : null
            );
            if (phoneMatch) {
                return line
                    .replace(phoneMatch, '')
                    .replace(/[,.\-\s]+$/, '') // Remove trailing punctuation
                    .replace(/^[,.\-\s]+/, '') // Remove leading punctuation
                    .trim();
            }
            return line;
        })
        .filter(line => line.length > 0); // Remove empty lines after phone removal
    
    const addressText = addressLines.join(', ');
    const addressInfo = await parseAddress(addressText, customerHint);
    
    // Calculate overall confidence
    let overallConfidence = 'low';
    const confidenceScores = {
        'high': 3,
        'medium': 2,
        'low': 1
    };
    
    const scores = [];
    if (phoneInfo) scores.push(confidenceScores[phoneInfo.confidence]);
    if (nameInfo) scores.push(confidenceScores[nameInfo.confidence]);
    if (addressInfo.province) scores.push(confidenceScores[addressInfo.confidence]);
    
    if (scores.length > 0) {
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avgScore >= 2.5) overallConfidence = 'high';
        else if (avgScore >= 1.5) overallConfidence = 'medium';
    }
    
    return {
        success: true,
        confidence: overallConfidence,
        data: {
            phone: phoneInfo?.phone || '',
            phoneConfidence: phoneInfo?.confidence || 'low',
            name: nameInfo?.name || '',
            nameConfidence: nameInfo?.confidence || 'low',
            address: {
                street: addressInfo.street,
                ward: addressInfo.ward,
                district: addressInfo.district,
                province: addressInfo.province,
                confidence: addressInfo.confidence,
                fullText: addressText
            }
        },
        warnings: []
    };
}

// ============================================
// WARD SUGGESTION TAGS (khi ward không tìm thấy)
// ============================================

/**
 * Tính top N phường/xã gợi ý bằng word-overlap scoring.
 * Nhẹ, nhanh (chỉ string compare, không Levenshtein).
 */
function _scoreWardSuggestions(wards, addressText, limit = 3) {
    if (!wards?.length || !addressText) return [];

    const addrNorm = removeVietnameseTones(addressText).toLowerCase();
    const scored = [];

    for (const ward of wards) {
        const labels = [ward.Name, ward.ShortName].filter(Boolean);
        let bestScore = 0;

        for (const label of labels) {
            const nameClean = removeVietnameseTones(label).toLowerCase()
                .replace(/^(phuong|xa|thi tran|tt)\s+/i, '');
            if (nameClean.length < 2) continue;

            let score = 0;
            if (addrNorm.includes(nameClean)) {
                score = 0.8 + Math.min(nameClean.length / 30, 0.2);
            } else {
                const wardWords = nameClean.split(/\s+/).filter(w => w.length >= 2);
                const matched = wardWords.filter(w => addrNorm.includes(w));
                if (matched.length > 0) {
                    score = (matched.length / wardWords.length) * 0.6;
                }
            }
            if (score > bestScore) bestScore = score;
        }

        if (bestScore > 0.15) scored.push({ ward, score: bestScore });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Hiển thị tag gợi ý phường/xã dưới grid địa chỉ.
 * Click tag → set ward dropdown + cập nhật preview + xóa tag.
 */
function renderWardSuggestions(province, addressText) {
    const old = document.getElementById('wardSuggestions');
    if (old) old.remove();

    if (!province?.Wards?.length) return;

    const wardSelect = document.getElementById('newOrderWard');
    if (!wardSelect) return;

    const suggestions = _scoreWardSuggestions(province.Wards, addressText);
    if (suggestions.length === 0) return;

    const container = document.createElement('div');
    container.id = 'wardSuggestions';
    container.className = 'mt-1.5 flex flex-wrap items-center gap-1.5';

    const label = document.createElement('span');
    label.className = 'text-xs text-gray-500';
    label.textContent = 'Gợi ý phường/xã:';
    container.appendChild(label);

    for (const { ward, score } of suggestions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isStrong = score >= 0.6;
        btn.className = isStrong
            ? 'px-2.5 py-0.5 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-full font-semibold transition-colors ring-1 ring-indigo-300'
            : 'px-2.5 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-medium transition-colors';
        btn.textContent = ward.Name;
        btn.title = `Score: ${score.toFixed(2)}`;
        btn.onclick = () => {
            wardSelect.value = ward.Id;
            wardSelect.dispatchEvent(new Event('change'));
            if (typeof syncDeskOrderStreetInputVisibility === 'function') {
                syncDeskOrderStreetInputVisibility();
            }
            container.remove();
            _setFieldConfidence(wardSelect, 'high');
        };
        container.appendChild(btn);
    }

    const gridContainer = wardSelect.closest('.grid');
    if (gridContainer) {
        gridContainer.parentElement.insertBefore(container, gridContainer.nextSibling);
    }
}

/**
 * Xóa gợi ý phường/xã.
 */
function clearWardSuggestions() {
    const el = document.getElementById('wardSuggestions');
    if (el) el.remove();
}

// ============================================
// SMART PASTE CONFIDENCE INDICATORS
// ============================================

const _confidenceRingClasses = {
    high:   ['ring-2', 'ring-green-500', 'border-green-400'],
    medium: ['ring-2', 'ring-amber-500', 'border-amber-400'],
    low:    ['ring-2', 'ring-red-500',   'border-red-400']
};
const _allRingClasses = Object.values(_confidenceRingClasses).flat();

function _setFieldConfidence(el, level) {
    if (!el) return;
    el.classList.remove(..._allRingClasses);
    const cls = _confidenceRingClasses[level];
    if (cls) el.classList.add(...cls);
}

/**
 * Hiển thị confidence trực quan trên các field địa chỉ sau smart paste.
 * Tự động xóa khi user thay đổi bất kỳ field nào.
 */
function showSmartPasteConfidence(data) {
    const ids = ['newOrderProvince', 'newOrderWard', 'newOrderStreetAddress'];
    const [provEl, wardEl, streetEl] = ids.map(id => document.getElementById(id));

    const addr = data.address;
    const overallConf = addr.confidence || 'low';

    _setFieldConfidence(provEl, addr.province ? 'high' : 'low');
    _setFieldConfidence(wardEl, addr.ward ? overallConf : 'low');

    if (addr.street) _setFieldConfidence(streetEl, 'high');

    // Tự động xóa indicator khi user thay đổi bất kỳ field nào
    const clearOnce = () => clearSmartPasteConfidence();
    const opts = { once: true };
    provEl?.addEventListener('change', clearOnce, opts);
    wardEl?.addEventListener('change', clearOnce, opts);
    streetEl?.addEventListener('input', clearOnce, opts);
}

/**
 * Xóa toàn bộ confidence indicator khỏi form địa chỉ.
 */
function clearSmartPasteConfidence() {
    ['newOrderProvince', 'newOrderWard', 'newOrderStreetAddress']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove(..._allRingClasses);
        });
    const badge = document.getElementById('smartPasteConfidenceBadge');
    if (badge) badge.remove();
    clearWardSuggestions();
}

/**
 * Apply parsed data to form fields
 */
async function applyParsedDataToForm(parsedData) {
    if (!parsedData.success) {
        return;
    }
    
    const { data, confidence } = parsedData;
    
    const addr = data.address;
    console.log(
        '\uD83D\uDCCB Smart paste result:',
        'phone=' + (data.phone || '(none)') +
        ' | name=' + (data.name || '(none)') +
        ' | ' + (addr.province?.Name || '(no province)') +
        ' \u2192 ' + (addr.ward?.Name || '(no ward)') +
        (addr.ward?.Id ? ' [' + addr.ward.Id + ']' : '') +
        ' | street: ' + (addr.street || '(empty)') +
        ' | confidence=' + confidence
    );
    
    // Apply phone
    if (data.phone) {
        document.getElementById('newOrderCustomerPhone').value = data.phone;
        // Trigger phone change event to check customer history
        document.getElementById('newOrderCustomerPhone').dispatchEvent(new Event('input'));
    }
    
    // Apply name
    if (data.name) {
        document.getElementById('newOrderCustomerName').value = data.name;
    }
    
    // Get address form elements (2 cấp: Tỉnh → Phường)
    const provinceSelect = document.getElementById('newOrderProvince');
    const wardSelect = document.getElementById('newOrderWard');
    const streetInput = document.getElementById('newOrderStreetAddress');

    // Apply address - Wait for addressSelector to be ready
    if (data.address.province) {
        if (!window.addressSelector || !window.addressSelector.loaded) {
            let attempts = 0;
            while ((!window.addressSelector || !window.addressSelector.loaded) && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (!window.addressSelector || !window.addressSelector.loaded) {
                console.error('❌ AddressSelector failed to load');
                return;
            }
        }

        provinceSelect.value = data.address.province.Id;

        // Render wards directly from province (2 cấp)
        window.addressSelector.renderWards(wardSelect, data.address.province.Id);

        const applyWard = () => {
            if (!data.address.ward) return false;
            wardSelect.value = data.address.ward.Id;
            return wardSelect.value === data.address.ward.Id;
        };

        if (data.address.ward) {
            if (!applyWard()) {
                await new Promise(resolve => setTimeout(resolve, 100));
                applyWard();
            }
            const wardMatched = wardSelect.value === data.address.ward.Id;
            console.log(
                '[applyParsedDataToForm] ward:',
                data.address.ward.Name + ' [' + data.address.ward.Id + ']',
                wardMatched ? '\u2713 applied' : '\u2717 mismatch (selected=' + wardSelect.value + ', options=' + wardSelect.options.length + ')'
            );
            if (wardSelect.value === data.address.ward.Id) {
                wardSelect.dispatchEvent(new Event('change'));
                clearWardSuggestions();
            } else {
                renderWardSuggestions(data.address.province, data.address.fullText);
            }
        } else if (data.address.fullText) {
            renderWardSuggestions(data.address.province, data.address.fullText);
        }

        if (data.address.street) {
            streetInput.value = data.address.street;
        }

        const fullAddress = window.addressSelector.generateFullAddress(
            streetInput.value,
            provinceSelect.value,
            wardSelect.value
        );

        syncOrderAddressPreview(fullAddress);

        const hiddenAddress = document.getElementById('newOrderAddress');
        if (hiddenAddress) hiddenAddress.value = fullAddress;

        if (typeof syncDeskAddressComboboxFromHidden === 'function') {
            syncDeskAddressComboboxFromHidden();
        }

        if (typeof syncDeskOrderStreetInputVisibility === 'function') {
            syncDeskOrderStreetInputVisibility();
        }
    }

    // Hiển thị confidence trực quan trên các dropdown
    showSmartPasteConfidence(data);
}

/**
 * Chờ HierarchicalAddressSelector trên mobile sẵn sàng (init async sau mở form).
 */
async function waitForMobileCreateAddressSelector(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        const sel = window.mCreateAddressSelector;
        if (sel && typeof sel.hydrateFromCodes === 'function') return sel;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

/**
 * Gợi ý phường/xã khi parser chỉ nhận tỉnh (giống renderWardSuggestions trên desktop).
 */
function _resolveWardForMobileApply(province, addressData) {
    if (addressData?.ward) return addressData.ward;
    if (!province?.Wards?.length) return null;
    const text = addressData?.fullText || '';
    if (!text) return null;

    const suggestions = _scoreWardSuggestions(province.Wards, text, 1);
    if (suggestions.length && suggestions[0].score >= 0.6) {
        console.log(
            '[applyParsedDataToMobileForm] auto-picked ward:',
            suggestions[0].ward.Name,
            suggestions[0].score.toFixed(2)
        );
        return suggestions[0].ward;
    }
    return null;
}

/**
 * Áp kết quả phân tích vào form tạo đơn mobile (m.html).
 */
async function applyParsedDataToMobileForm(parsedData) {
    const applied = [];
    if (!parsedData?.success) return { applied, confidence: parsedData?.confidence || 'low' };

    const { data, confidence } = parsedData;
    const addr = data.address;

    console.log(
        '\uD83D\uDCF1 Mobile smart paste result:',
        'phone=' + (data.phone || '(none)') +
        ' | name=' + (data.name || '(none)') +
        ' | ' + (addr?.province?.Name || '(no province)') +
        ' \u2192 ' + (addr?.ward?.Name || '(no ward)') +
        (addr?.ward?.Id ? ' [' + addr.ward.Id + ']' : '') +
        ' | street: ' + (addr?.street || '(empty)') +
        ' | confidence=' + confidence
    );

    if (data.phone) {
        const phoneEl = document.getElementById('cPhone');
        if (phoneEl) {
            phoneEl.value = data.phone;
            if (typeof clearFieldError === 'function') clearFieldError('cPhone');
        }
        applied.push('SĐT');
    }

    if (data.name) {
        const nameEl = document.getElementById('cName');
        if (nameEl) {
            nameEl.value = typeof mTitleCaseCustomerName === 'function'
                ? mTitleCaseCustomerName(data.name)
                : data.name;
            if (typeof clearFieldError === 'function') clearFieldError('cName');
        }
        applied.push('Tên');
    }

    if (!addr?.province) return { applied, confidence };

    if (!window.addressSelector || !window.addressSelector.loaded) {
        let attempts = 0;
        while ((!window.addressSelector || !window.addressSelector.loaded) && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.addressSelector || !window.addressSelector.loaded) {
            console.error('\u274C AddressSelector failed to load (mobile)');
            return { applied, confidence };
        }
    }

    const provinceSelect = document.getElementById('newOrderProvince');
    const wardSelect = document.getElementById('newOrderWard');
    const streetInput = document.getElementById('newOrderStreetAddress');
    if (!provinceSelect || !wardSelect) {
        console.error('\u274C Mobile address selects not ready');
        return { applied, confidence };
    }

    provinceSelect.value = addr.province.Id;
    window.addressSelector.renderWards(wardSelect, addr.province.Id);

    const ward = _resolveWardForMobileApply(addr.province, addr);

    const applyWard = () => {
        if (!ward) return false;
        wardSelect.value = ward.Id;
        return wardSelect.value === ward.Id;
    };

    if (ward) {
        if (!applyWard()) {
            await new Promise(resolve => setTimeout(resolve, 100));
            applyWard();
        }
        if (wardSelect.value === ward.Id) {
            wardSelect.dispatchEvent(new Event('change'));
            if (typeof clearWardSuggestions === 'function') clearWardSuggestions();
        } else if (addr.fullText && typeof renderWardSuggestions === 'function') {
            renderWardSuggestions(addr.province, addr.fullText);
        }
    } else if (addr.fullText && typeof renderWardSuggestions === 'function') {
        renderWardSuggestions(addr.province, addr.fullText);
    }

    if (addr.street && streetInput) {
        streetInput.value = addr.street;
    }

    if (typeof syncDeskAddressComboboxFromHidden === 'function') {
        syncDeskAddressComboboxFromHidden();
    }
    if (typeof syncDeskOrderStreetInputVisibility === 'function') {
        syncDeskOrderStreetInputVisibility();
    }

    const fullAddress = window.addressSelector.generateFullAddress(
        streetInput?.value || '',
        provinceSelect.value,
        wardSelect.value
    );
    syncOrderAddressPreview(fullAddress);
    const hiddenAddress = document.getElementById('newOrderAddress');
    if (hiddenAddress) hiddenAddress.value = fullAddress;

    if (typeof clearFieldError === 'function') clearFieldError('mAddressFormBlock');
    applied.push('Địa chỉ');

    return { applied, confidence };
}

// ============================================
// DESKTOP SMART PASTE — auto on paste
// ============================================

let _deskSmartPasteBusy = false;
let _deskSmartPasteTimer = null;

const DESK_SMART_PASTE_AUTO_DELAY_MS = 50;
const DESK_SMART_PASTE_MIN_CHARS = 8;

const _DESK_SMART_PASTE_SPIN_SVG =
    '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>' +
    '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>';

const _DESK_SMART_PASTE_ICON_SVG =
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />';

function _setDeskSmartPasteLoading(loading) {
    const btn = document.getElementById('smartPasteBtn');
    const btnText = document.getElementById('smartPasteBtnText');
    const btnIcon = document.getElementById('smartPasteIcon');
    const statusEl = document.getElementById('smartPasteStatus');

    if (btn) btn.disabled = loading;
    if (btnText) btnText.textContent = loading ? 'Đang phân tích...' : 'Phân tích lại';
    if (btnIcon) {
        btnIcon.innerHTML = loading ? _DESK_SMART_PASTE_SPIN_SVG : _DESK_SMART_PASTE_ICON_SVG;
        btnIcon.classList.toggle('animate-spin', loading);
    }
    if (loading && statusEl) {
        statusEl.className = 'text-xs text-purple-600 mt-1.5';
        statusEl.textContent = 'Đang phân tích...';
        statusEl.classList.remove('hidden');
    }
}

function _showDeskSmartPasteResult(parsedData) {
    const statusEl = document.getElementById('smartPasteStatus');
    if (!statusEl) return;

    if (!parsedData?.success) {
        statusEl.className = 'text-xs text-red-500 mt-1.5';
        statusEl.textContent = parsedData?.error || 'Không thể phân tích';
        statusEl.classList.remove('hidden');
        return;
    }

    const d = parsedData.data || {};
    const parts = [];
    if (d.name) parts.push('Tên');
    if (d.phone) parts.push('SĐT');
    if (d.address?.province) parts.push('Địa chỉ');

    const conf = parsedData.confidence;
    const color = conf === 'high' ? 'text-emerald-600'
        : conf === 'medium' ? 'text-amber-600'
            : 'text-red-500';

    statusEl.className = 'text-xs mt-1.5 ' + color;
    statusEl.textContent = parts.length
        ? '\u2713 \u0110\u00e3 \u0111i\u1ec1n: ' + parts.join(', ')
        : 'Kh\u00f4ng nh\u1eadn di\u1ec7n \u0111\u01b0\u1ee3c th\u00f4ng tin';
    statusEl.classList.remove('hidden');
}

/**
 * Chạy phân tích nhanh desktop (nút hoặc auto sau paste).
 * @param {{ silentEmpty?: boolean }} options
 */
async function runDeskSmartPaste(options = {}) {
    const silentEmpty = options.silentEmpty === true;
    const textarea = document.getElementById('smartPasteInput');
    const text = (textarea?.value || '').trim();
    const errorMsg = document.getElementById('smartPasteError');

    if (errorMsg) errorMsg.classList.add('hidden');

    if (!text) {
        if (!silentEmpty && errorMsg) errorMsg.classList.remove('hidden');
        return { ok: false, reason: 'empty' };
    }

    if (text.length < DESK_SMART_PASTE_MIN_CHARS) {
        if (!silentEmpty && errorMsg) {
            errorMsg.textContent = 'N\u1ed9i dung qu\u00e1 ng\u1eafn \u0111\u1ec3 ph\u00e2n t\u00edch';
            errorMsg.classList.remove('hidden');
        }
        return { ok: false, reason: 'short' };
    }

    if (_deskSmartPasteBusy) return { ok: false, reason: 'busy' };

    _deskSmartPasteBusy = true;
    _setDeskSmartPasteLoading(true);

    try {
        const parsedData = await smartParseCustomerInfo(text);
        if (!parsedData?.success) {
            _showDeskSmartPasteResult(parsedData);
            return { ok: false, data: parsedData };
        }
        await applyParsedDataToForm(parsedData);
        _showDeskSmartPasteResult(parsedData);
        return { ok: true, data: parsedData };
    } catch (err) {
        _showDeskSmartPasteResult({ success: false, error: err.message || 'L\u1ed7i ph\u00e2n t\u00edch' });
        return { ok: false, error: err };
    } finally {
        _deskSmartPasteBusy = false;
        _setDeskSmartPasteLoading(false);
    }
}

/** Gắn listener paste — gọi một lần khi modal tạo đơn được mở. */
function setupDeskSmartPasteAuto() {
    const ta = document.getElementById('smartPasteInput');
    if (!ta || ta.dataset.autoParseBound === '1') return;
    ta.dataset.autoParseBound = '1';

    ta.addEventListener('paste', () => {
        clearTimeout(_deskSmartPasteTimer);
        _deskSmartPasteTimer = setTimeout(() => {
            runDeskSmartPaste({ silentEmpty: true });
        }, DESK_SMART_PASTE_AUTO_DELAY_MS);
    });
}

window.runDeskSmartPaste = runDeskSmartPaste;
window.setupDeskSmartPasteAuto = setupDeskSmartPasteAuto;

// Initialize on page load - NO LONGER NEEDED, use addressSelector data
// (removed loadVietnamAddressData call)
