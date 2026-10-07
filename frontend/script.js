// API base URL - use relative path to work from any host
const API_URL = '/api';

// Global state
let currentSessionId = null;

// DOM elements
let chatMessages, chatInput, sendButton, totalCourses, courseTitles;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements after page loads
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendButton = document.getElementById('sendButton');
    totalCourses = document.getElementById('totalCourses');
    courseTitles = document.getElementById('courseTitles');
    
    setupEventListeners();
    createNewSession();
    loadCourseStats();
});

// Event Listeners
function setupEventListeners() {
    // Chat functionality
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    
    // New chat: reset the conversation and start a fresh session
    document.getElementById('newChatButton').addEventListener('click', () => {
        createNewSession();
        chatInput.focus();
    });

    // Suggested questions
    document.querySelectorAll('.suggested-item').forEach(button => {
        button.addEventListener('click', (e) => {
            const question = e.target.getAttribute('data-question');
            chatInput.value = question;
            sendMessage();
        });
    });
}


// Chat Functions
async function sendMessage() {
    const query = chatInput.value.trim();
    if (!query) return;

    // Disable input
    chatInput.value = '';
    chatInput.disabled = true;
    sendButton.disabled = true;

    // Add user message
    addMessage(query, 'user');

    // Add loading message - create a unique container for it
    const loadingMessage = createLoadingMessage();
    chatMessages.appendChild(loadingMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch(`${API_URL}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                session_id: currentSessionId
            })
        });

        if (!response.ok) throw new Error('Query failed');

        const data = await response.json();
        
        // Update session ID if new
        if (!currentSessionId) {
            currentSessionId = data.session_id;
        }

        // Replace loading message with response
        loadingMessage.remove();
        addMessage(data.answer, 'assistant', data.sources);

    } catch (error) {
        // Replace loading message with error
        loadingMessage.remove();
        addMessage(`Error: ${error.message}`, 'assistant');
    } finally {
        chatInput.disabled = false;
        sendButton.disabled = false;
        chatInput.focus();
    }
}

function createLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="loading">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    return messageDiv;
}

function addMessage(content, type, sources = null, isWelcome = false) {
    const messageId = Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}${isWelcome ? ' welcome-message' : ''}`;
    messageDiv.id = `message-${messageId}`;
    
    // Convert markdown to HTML for assistant messages
    const displayContent = type === 'assistant' ? marked.parse(content) : escapeHtml(content);
    
    let html = `<div class="message-content">${displayContent}</div>`;
    
    if (sources && sources.length > 0) {
        html += `
            <details class="sources-collapsible">
                <summary class="sources-header">Sources <span class="sources-count">${sources.length}</span></summary>
                <div class="sources-content">${renderSources(sources)}</div>
            </details>
        `;
    }
    
    messageDiv.innerHTML = html;
    if (type === 'assistant') {
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.querySelectorAll('a').forEach(a => {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        });
        if (enhanceOutline(contentDiv)) messageDiv.classList.add('message-outline');
    }
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageId;
}

// Turn an outline answer (## course, ### Lesson N blocks) into a header plus lesson cards.
// Returns true if the content looked like an outline.
function enhanceOutline(content) {
    const lessonPattern = /^Lesson\s+(\d+)\s*:\s*(.+)$/i;
    const headings = [...content.querySelectorAll(':scope > h3')]
        .filter(h => lessonPattern.test(h.textContent.trim()));
    if (headings.length === 0) return false;

    content.classList.add('outline');

    // Everything from the course heading up to the first lesson becomes the header
    const courseHeading = content.querySelector(':scope > h2');
    if (courseHeading) {
        const header = document.createElement('div');
        header.className = 'outline-header';
        content.insertBefore(header, courseHeading);
        while (header.nextSibling && header.nextSibling !== headings[0]) {
            header.appendChild(header.nextSibling);
        }
    }

    const list = document.createElement('div');
    list.className = 'lesson-list';
    content.insertBefore(list, headings[0]);

    for (const heading of headings) {
        const [, number, title] = heading.textContent.trim().match(lessonPattern);
        const card = document.createElement('section');
        card.className = 'lesson-card';
        const body = document.createElement('div');
        body.className = 'lesson-body';

        // Move the lesson's summary and key points (up to the next heading) into the card body
        let next = heading.nextSibling;
        while (next && !/^H[1-3]$/.test(next.nodeName)) {
            const following = next.nextSibling;
            body.appendChild(next);
            next = following;
        }

        // Rebuild the heading as: [number badge] title (keeping the lesson link)
        const link = heading.querySelector('a');
        const titleEl = link || document.createElement('span');
        titleEl.textContent = title;
        titleEl.classList.add('lesson-title');
        heading.replaceChildren();
        const badge = document.createElement('span');
        badge.className = 'lesson-badge';
        badge.textContent = number;
        heading.append(badge, titleEl);

        card.appendChild(heading);
        if (body.textContent.trim()) card.appendChild(body);
        list.appendChild(card);
    }
    return true;
}

// Render a link only for http(s) URLs; otherwise fall back to a plain span
function sourceLink(url, className, innerHtml) {
    if (url && /^https?:\/\//i.test(url)) {
        const href = escapeHtml(url).replace(/"/g, '&quot;');
        return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`;
    }
    return `<span class="${className}">${innerHtml}</span>`;
}

// Group sources by course: course title once, then one chip per lesson
function renderSources(sources) {
    const groups = new Map();
    for (const source of sources) {
        const title = source.course_title || source.text;
        if (!groups.has(title)) {
            groups.set(title, { courseUrl: source.course_url, lessons: [] });
        }
        groups.get(title).lessons.push(source);
    }

    const externalIcon = '<svg class="source-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

    return [...groups].map(([title, group]) => {
        const lessons = group.lessons
            .filter(s => s.lesson_number !== null && s.lesson_number !== undefined)
            .sort((a, b) => a.lesson_number - b.lesson_number)
            .map(s => sourceLink(s.url, 'source-chip', `Lesson ${s.lesson_number}${externalIcon}`))
            .join('');
        return `
            <div class="source-group">
                ${sourceLink(group.courseUrl, 'source-course', escapeHtml(title))}
                ${lessons ? `<div class="source-chips">${lessons}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Helper function to escape HTML for user messages
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Removed removeMessage function - no longer needed since we handle loading differently

async function createNewSession() {
    currentSessionId = null;
    chatMessages.innerHTML = '';
    addMessage('Welcome to the Course Materials Assistant! I can help you with questions about courses, lessons and specific content. What would you like to know?', 'assistant', null, true);
}

// Load course statistics
async function loadCourseStats() {
    try {
        console.log('Loading course stats...');
        const response = await fetch(`${API_URL}/courses`);
        if (!response.ok) throw new Error('Failed to load course stats');
        
        const data = await response.json();
        console.log('Course data received:', data);
        
        // Update stats in UI
        if (totalCourses) {
            totalCourses.textContent = data.total_courses;
        }
        
        // Update course titles
        if (courseTitles) {
            if (data.course_titles && data.course_titles.length > 0) {
                courseTitles.innerHTML = data.course_titles
                    .map(title => `<div class="course-title-item">${title}</div>`)
                    .join('');
            } else {
                courseTitles.innerHTML = '<span class="no-courses">No courses available</span>';
            }
        }
        
    } catch (error) {
        console.error('Error loading course stats:', error);
        // Set default values on error
        if (totalCourses) {
            totalCourses.textContent = '0';
        }
        if (courseTitles) {
            courseTitles.innerHTML = '<span class="error">Failed to load courses</span>';
        }
    }
}