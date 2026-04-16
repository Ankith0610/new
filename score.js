import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { auth } from "./firebase-service.js";
import { getQuizAccessRecord, isResumeApproved, markQuizResumed } from "./quiz-access.js";
import { syncQuizSessionOwner } from "./quiz-session.js";

const QUIZ_GUARD_STORAGE_KEY = "quizGuardState";
const QUIZ_RESULT_STATUS_KEY = "quizResultStatus";
const QUIZ_RESULT_SUMMARY_KEY = "quizResultSummary";

const elements = {
    resultTitle: document.getElementById("resultTitle"),
    resultMessage: document.getElementById("resultMessage"),
    resultScore: document.getElementById("resultScore"),
    resultTime: document.getElementById("resultTime"),
    resultStatus: document.getElementById("resultStatus"),
    resultTimestamp: document.getElementById("resultTimestamp"),
    resumeSection: document.getElementById("resumeSection"),
    resumeHelpText: document.getElementById("resumeHelpText"),
    resumeError: document.getElementById("resumeError"),
    resumeButton: document.getElementById("resumeQuizButton"),
    backButton: document.getElementById("backButton")
};

let currentUser = null;
let currentQuizAccessRecord = null;

function getQuizStatus() {
    const params = new URLSearchParams(window.location.search);
    return params.get("status") || localStorage.getItem(QUIZ_RESULT_STATUS_KEY) || "";
}

function getQuizSummary() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUIZ_RESULT_SUMMARY_KEY) || "{}");
        return {
            answeredCount: Number.isFinite(Number(parsed.answeredCount)) ? Number(parsed.answeredCount) : 0,
            totalQuestions: Number.isFinite(Number(parsed.totalQuestions)) ? Number(parsed.totalQuestions) : 0,
            elapsedSeconds: Number.isFinite(Number(parsed.elapsedSeconds)) ? Number(parsed.elapsedSeconds) : 0,
            completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : ""
        };
    } catch (error) {
        return {
            answeredCount: 0,
            totalQuestions: 0,
            elapsedSeconds: 0,
            completedAt: ""
        };
    }
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder
        .toString()
        .padStart(2, "0")}`;
}

function formatTimestamp(value) {
    if (!value) {
        return "Result recorded just now";
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : `Recorded on ${parsed.toLocaleString()}`;
}

function renderResult(status, summary) {
    if (!status) {
        elements.resultTitle.textContent = "No Quiz Result Yet";
        elements.resultMessage.textContent = "Start the quiz to see your result and time.";
        elements.resultScore.textContent = "0 / 0";
        elements.resultTime.textContent = "00:00:00";
        elements.resultStatus.textContent = "No Result";
        elements.resultTimestamp.textContent = "No attempt recorded for this account";
        elements.resumeHelpText.textContent = "Only the admin can approve a resume after disqualification.";
        elements.resumeError.textContent = "";
        elements.resumeSection.hidden = true;
        elements.resumeButton.hidden = true;
        return;
    }

    elements.resultScore.textContent = `${summary.answeredCount} / ${summary.totalQuestions}`;
    elements.resultTime.textContent = formatDuration(summary.elapsedSeconds);
    elements.resultTimestamp.textContent = formatTimestamp(summary.completedAt);
    elements.resumeHelpText.textContent = "Only the admin can approve a resume after disqualification.";
    elements.resumeError.textContent = "";

    if (status === "disqualified") {
        elements.resultTitle.textContent = "Quiz Disqualified";
        elements.resultMessage.textContent = "You left the quiz page more than once, so you are disqualified. Ask the admin to approve a resume for your account.";
        elements.resultStatus.textContent = "Disqualified";
        elements.resumeSection.hidden = false;
        elements.resumeButton.hidden = false;
        elements.resumeButton.textContent = "Refresh Approval Status";
        return;
    }

    elements.resultTitle.textContent = "Quiz Completed";
    elements.resultMessage.textContent = "Thank you for participating.";
    elements.resultStatus.textContent = "Completed";
    elements.resumeSection.hidden = true;
    elements.resumeButton.hidden = true;
}

function clearDisqualificationState() {
    localStorage.removeItem(QUIZ_RESULT_STATUS_KEY);
    localStorage.removeItem(QUIZ_RESULT_SUMMARY_KEY);
    localStorage.removeItem("quizSubmitted");
    localStorage.setItem(
        QUIZ_GUARD_STORAGE_KEY,
        JSON.stringify({
            leaveCount: 0,
            pendingAttempt: 0,
            disqualified: false
        })
    );
}

function setResumeMessage(message, isError = false) {
    elements.resumeError.textContent = message;
    elements.resumeError.style.color = isError ? "#9e132b" : "#213364";
}

function updateResumeControls() {
    if (quizStatus !== "disqualified") {
        return;
    }

    if (isResumeApproved(currentQuizAccessRecord)) {
        const approver = currentQuizAccessRecord.quizAdminState.approvedByEmail || "the admin";
        const approvedAt = formatTimestamp(currentQuizAccessRecord.quizAdminState.approvedAt).replace("Recorded on ", "");
        elements.resumeHelpText.textContent = "Admin approval received for this disqualified attempt.";
        setResumeMessage(`Resume approved by ${approver}${approvedAt ? ` on ${approvedAt}` : ""}.`);
        elements.resumeButton.textContent = "Resume Quiz";
        return;
    }

    elements.resumeHelpText.textContent = "Only the admin can approve a resume after disqualification.";
    setResumeMessage("Approval is still pending. Ask the admin to grant resume access, then refresh here.");
    elements.resumeButton.textContent = "Refresh Approval Status";
}

async function refreshResumeApprovalStatus(showCheckingMessage = true) {
    if (quizStatus !== "disqualified") {
        return;
    }

    if (!currentUser) {
        setResumeMessage("Please sign in again to check your resume approval.", true);
        return;
    }

    if (showCheckingMessage) {
        setResumeMessage("Checking admin approval...");
    }

    try {
        currentQuizAccessRecord = await getQuizAccessRecord(currentUser.uid);
        updateResumeControls();
    } catch (error) {
        console.error("Unable to load the resume approval state:", error);
        setResumeMessage("Unable to check admin approval right now. Please try again.", true);
    }
}

async function handleResumeAction() {
    if (!isResumeApproved(currentQuizAccessRecord)) {
        await refreshResumeApprovalStatus(true);
        return;
    }

    try {
        setResumeMessage("Opening your approved quiz session...");
        await markQuizResumed(currentUser);
        clearDisqualificationState();
        window.location.href = "quiz.html";
    } catch (error) {
        console.error("Unable to resume the quiz:", error);
        setResumeMessage("Admin approval was found, but the quiz could not be reopened. Please try again.", true);
    }
}

syncQuizSessionOwner(localStorage.getItem("loggedInUserId") || "");

const quizStatus = getQuizStatus();
const quizSummary = getQuizSummary();

renderResult(quizStatus, quizSummary);

elements.resumeButton.addEventListener("click", () => {
    void handleResumeAction();
});

elements.backButton.addEventListener("click", () => {
    window.location.href = "dashboard.html";
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    localStorage.setItem("loggedInUserId", user.uid);
    syncQuizSessionOwner(user.uid);

    if (quizStatus === "disqualified") {
        await refreshResumeApprovalStatus(false);
    }
});
