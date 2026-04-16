const QUIZ_SESSION_OWNER_KEY = "quizSessionUserId";
const QUIZ_SESSION_KEYS = [
    "quizAnswers",
    "quizStartTime",
    "quizSubmitted",
    "quizGuardState",
    "quizResultStatus",
    "quizResultSummary",
    "quizStarted"
];

function clearQuizSessionState() {
    QUIZ_SESSION_KEYS.forEach((key) => {
        localStorage.removeItem(key);
    });
}

function syncQuizSessionOwner(userId) {
    if (!userId) {
        return;
    }

    const previousOwner = localStorage.getItem(QUIZ_SESSION_OWNER_KEY);

    if (previousOwner && previousOwner !== userId) {
        clearQuizSessionState();
    }

    localStorage.setItem(QUIZ_SESSION_OWNER_KEY, userId);
}

export { clearQuizSessionState, syncQuizSessionOwner };
