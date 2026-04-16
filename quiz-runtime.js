import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { auth } from "./firebase-service.js";
import { markQuizDisqualified, markQuizSubmitted } from "./quiz-access.js";
import { cloneSiteConfig, defaultSiteConfig, getSiteConfig } from "./site-config.js";
import { syncQuizSessionOwner } from "./quiz-session.js";

const MAX_PAGE_LEAVES = 1;
const QUIZ_GUARD_STORAGE_KEY = "quizGuardState";
const QUIZ_RESULT_STATUS_KEY = "quizResultStatus";
const QUIZ_RESULT_SUMMARY_KEY = "quizResultSummary";

let siteConfig = cloneSiteConfig(defaultSiteConfig);
let currentQuestion = 0;
let answers = [];
let timerInterval = null;
let timeLeft = 0;

const elements = {
    timer: document.getElementById("timer"),
    questionText: document.getElementById("question-text"),
    questionImage: document.getElementById("question-image"),
    answerBox: document.getElementById("answer-box"),
    notesBox: document.getElementById("notes-box"),
    prevButton: document.getElementById("prev-btn"),
    nextButton: document.getElementById("next-btn"),
    submitButton: document.getElementById("submit-btn"),
    resumeModal: document.getElementById("resume-modal"),
    resumeTitle: document.getElementById("resume-title"),
    resumeMessage: document.getElementById("resume-message"),
    resumePassword: document.getElementById("resume-password")
};

function createDefaultGuardState() {
    return {
        leaveCount: 0,
        pendingAttempt: 0,
        disqualified: false
    };
}

function loadGuardState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUIZ_GUARD_STORAGE_KEY) || "{}");
        return {
            leaveCount: Number.isFinite(Number(parsed.leaveCount)) ? Math.max(0, Number(parsed.leaveCount)) : 0,
            pendingAttempt: Number.isFinite(Number(parsed.pendingAttempt)) ? Math.max(0, Number(parsed.pendingAttempt)) : 0,
            disqualified: Boolean(parsed.disqualified)
        };
    } catch (error) {
        return createDefaultGuardState();
    }
}

function saveGuardState(state) {
    localStorage.setItem(QUIZ_GUARD_STORAGE_KEY, JSON.stringify(state));
}

function clearGuardState() {
    localStorage.removeItem(QUIZ_GUARD_STORAGE_KEY);
}

function getQuizResultStatus() {
    return localStorage.getItem(QUIZ_RESULT_STATUS_KEY) || "";
}

function setQuizResultStatus(status) {
    localStorage.setItem(QUIZ_RESULT_STATUS_KEY, status);
}

function setQuizResultSummary(summary) {
    localStorage.setItem(QUIZ_RESULT_SUMMARY_KEY, JSON.stringify(summary));
}

function getQuizDurationSeconds() {
    return Math.max(60, Number(siteConfig.quizDurationMinutes || 120) * 60);
}

function getQuestions() {
    return siteConfig.questions || cloneSiteConfig(defaultSiteConfig.questions);
}

function getResumePasswords() {
    if (Array.isArray(siteConfig.resumePasswords) && siteConfig.resumePasswords.length) {
        return siteConfig.resumePasswords;
    }

    return cloneSiteConfig(defaultSiteConfig.resumePasswords);
}

function getResumePasswordForAttempt(attemptNumber) {
    const passwords = getResumePasswords();
    return passwords[attemptNumber - 1] || passwords[passwords.length - 1] || siteConfig.resumePassword || "";
}

function syncAnswers() {
    const savedAnswers = JSON.parse(localStorage.getItem("quizAnswers") || "[]");
    const questions = getQuestions();
    answers = new Array(questions.length).fill("").map((_, index) => savedAnswers[index] || "");
    localStorage.setItem("quizAnswers", JSON.stringify(answers));
}

function saveAnswer() {
    answers[currentQuestion] = elements.answerBox.value.trim();
    localStorage.setItem("quizAnswers", JSON.stringify(answers));
}

function updateQuestionUI() {
    const questions = getQuestions();
    const question = questions[currentQuestion];

    elements.questionText.textContent = `${currentQuestion + 1}. ${question.question}`;
    elements.questionImage.src = question.image || "blank.png";
    elements.questionImage.alt = question.question || "Question Image";
    elements.answerBox.value = answers[currentQuestion] || "";
    elements.notesBox.textContent = question.note || "Answer the question based on the given image and description.";
    elements.prevButton.disabled = currentQuestion === 0;

    if (currentQuestion === questions.length - 1) {
        elements.nextButton.style.display = "none";
        elements.submitButton.style.display = "inline-block";
    } else {
        elements.nextButton.style.display = "inline-block";
        elements.submitButton.style.display = "none";
    }
}

function nextQuestion() {
    saveAnswer();

    if (currentQuestion < getQuestions().length - 1) {
        currentQuestion += 1;
        updateQuestionUI();
    }
}

function previousQuestion() {
    saveAnswer();

    if (currentQuestion > 0) {
        currentQuestion -= 1;
        updateQuestionUI();
    }
}

function renderTimer() {
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;
    elements.timer.textContent = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getAnsweredCount() {
    return answers.filter((answer) => String(answer || "").trim()).length;
}

function getElapsedSeconds() {
    const startTime = Number(localStorage.getItem("quizStartTime"));
    if (!startTime) {
        return 0;
    }

    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - startTime;
    return Math.max(0, Math.min(elapsed, getQuizDurationSeconds()));
}

function buildQuizResultSummary(status) {
    return {
        status,
        answeredCount: getAnsweredCount(),
        totalQuestions: getQuestions().length,
        elapsedSeconds: getElapsedSeconds(),
        completedAt: new Date().toISOString()
    };
}

function redirectToScore(status) {
    window.location.href = `score.html?status=${encodeURIComponent(status)}`;
}

async function finishQuiz(status) {
    clearInterval(timerInterval);
    saveAnswer();
    setQuizResultStatus(status);
    setQuizResultSummary(buildQuizResultSummary(status));

    if (status === "submitted") {
        localStorage.setItem("quizSubmitted", "true");
        localStorage.removeItem("quizAnswers");
        localStorage.removeItem("quizStartTime");
        clearGuardState();
    } else {
        localStorage.removeItem("quizSubmitted");
    }

    if (status === "submitted") {
        try {
            await markQuizSubmitted(auth.currentUser);
        } catch (error) {
            console.error("Unable to save the submitted quiz state:", error);
        }
    }

    redirectToScore(status);
}

async function submitQuiz(skipConfirmation = false) {
    if (!skipConfirmation && !confirm("Are you sure you want to submit the quiz?")) {
        startTimer();
        return;
    }

    await finishQuiz("submitted");
}

async function disqualifyQuiz() {
    const nextState = loadGuardState();
    nextState.disqualified = true;
    nextState.pendingAttempt = 0;
    saveGuardState(nextState);

    try {
        await markQuizDisqualified(auth.currentUser, {
            pageLeaveCount: nextState.leaveCount,
            reason: "page-leave-limit"
        });
    } catch (error) {
        console.error("Unable to save the disqualified quiz state:", error);
    }

    alert("You exceeded the maximum allowed page leaves. You are disqualified from the quiz. Contact the admin if you need resume access.");
    await finishQuiz("disqualified");
}

function startTimer() {
    clearInterval(timerInterval);

    const durationSeconds = getQuizDurationSeconds();
    const now = Math.floor(Date.now() / 1000);
    let startTime = Number(localStorage.getItem("quizStartTime"));

    if (!startTime) {
        startTime = now;
        localStorage.setItem("quizStartTime", String(now));
    }

    timeLeft = durationSeconds - (now - startTime);

    if (timeLeft <= 0) {
        alert("Time's up! Submitting your quiz...");
        void submitQuiz(true);
        return;
    }

    renderTimer();

    timerInterval = setInterval(() => {
        timeLeft -= 1;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("Time's up! Submitting your quiz...");
            void submitQuiz(true);
            return;
        }

        renderTimer();
    }, 1000);
}

function showResumeModal(attemptNumber) {
    const remainingLeaves = MAX_PAGE_LEAVES - attemptNumber;
    elements.resumeTitle.textContent = "Resume Required";
    elements.resumeMessage.textContent =
        remainingLeaves > 0
            ? `You left the quiz page ${attemptNumber} time${attemptNumber === 1 ? "" : "s"}. Enter resume password ${attemptNumber} to continue. ${remainingLeaves} leave${remainingLeaves === 1 ? "" : "s"} remaining before disqualification.`
            : `You left the quiz page ${attemptNumber} time${attemptNumber === 1 ? "" : "s"}. Enter resume password ${attemptNumber} to continue. Any further leave will disqualify you.`;
    elements.resumePassword.value = "";
    elements.resumeModal.style.display = "flex";
}

function hideResumeModal() {
    elements.resumePassword.value = "";
    elements.resumeModal.style.display = "none";
}

async function registerPageLeave() {
    const guardState = loadGuardState();

    if (guardState.disqualified || guardState.pendingAttempt > 0) {
        return;
    }

    const nextLeaveCount = guardState.leaveCount + 1;

    if (nextLeaveCount > MAX_PAGE_LEAVES) {
        await disqualifyQuiz();
        return;
    }

    const nextState = {
        leaveCount: nextLeaveCount,
        pendingAttempt: nextLeaveCount,
        disqualified: false
    };

    saveGuardState(nextState);
    showResumeModal(nextLeaveCount);
}

window.verifyResumePassword = function () {
    const guardState = loadGuardState();
    const attemptNumber = guardState.pendingAttempt;
    const enteredPassword = elements.resumePassword.value.trim();

    if (!attemptNumber) {
        hideResumeModal();
        return;
    }

    if (enteredPassword === getResumePasswordForAttempt(attemptNumber)) {
        saveGuardState({
            ...guardState,
            pendingAttempt: 0
        });
        hideResumeModal();
        return;
    }

    alert(`Incorrect password. Please enter resume password ${attemptNumber}.`);
    elements.resumePassword.value = "";
};

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        void registerPageLeave();
    }
});

document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    alert("Right-click is disabled during the quiz.");
});

document.addEventListener("copy", (event) => {
    event.preventDefault();
    alert("Copying content is disabled during the quiz.");
});

document.addEventListener("paste", (event) => {
    event.preventDefault();
    alert("Pasting content is disabled during the quiz.");
});

document.addEventListener("keydown", (event) => {
    if (event.key === "F12" || (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === "I")) {
        event.preventDefault();
        alert("Developer tools are disabled during the quiz.");
    }
});

elements.nextButton.addEventListener("click", nextQuestion);
elements.prevButton.addEventListener("click", previousQuestion);
elements.submitButton.addEventListener("click", () => {
    void submitQuiz(false);
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    localStorage.setItem("loggedInUserId", user.uid);
    syncQuizSessionOwner(user.uid);
    siteConfig = await getSiteConfig();

    const quizResultStatus = getQuizResultStatus();
    if (quizResultStatus === "submitted" || quizResultStatus === "disqualified") {
        redirectToScore(quizResultStatus);
        return;
    }

    const guardState = loadGuardState();
    if (guardState.disqualified || guardState.leaveCount > MAX_PAGE_LEAVES) {
        setQuizResultStatus("disqualified");
        redirectToScore("disqualified");
        return;
    }

    syncAnswers();
    updateQuestionUI();
    startTimer();

    if (guardState.pendingAttempt > 0) {
        showResumeModal(guardState.pendingAttempt);
    }
});
