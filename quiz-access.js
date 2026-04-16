import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    where
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { db } from "./firebase-service.js";

const USERS_COLLECTION = "users";

function normalizeString(value, fallback = "") {
    if (typeof value !== "string") {
        return fallback;
    }

    const trimmed = value.trim();
    return trimmed || fallback;
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function createRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQuizState(raw = {}) {
    return {
        status: normalizeString(raw.status, "idle"),
        requestId: normalizeString(raw.requestId, ""),
        disqualifiedAt: normalizeString(raw.disqualifiedAt, ""),
        pageLeaveCount: Math.max(0, normalizeNumber(raw.pageLeaveCount, 0)),
        reason: normalizeString(raw.reason, ""),
        resumedAt: normalizeString(raw.resumedAt, ""),
        updatedAt: normalizeString(raw.updatedAt, "")
    };
}

function normalizeQuizAdminState(raw = {}) {
    return {
        approvedResumeRequestId: normalizeString(raw.approvedResumeRequestId, ""),
        approvedAt: normalizeString(raw.approvedAt, ""),
        approvedByUid: normalizeString(raw.approvedByUid, ""),
        approvedByEmail: normalizeString(raw.approvedByEmail, ""),
        updatedAt: normalizeString(raw.updatedAt, "")
    };
}

function normalizeParticipantRecord(userId, raw = {}) {
    const quizState = normalizeQuizState(raw.quizState);
    const quizAdminState = normalizeQuizAdminState(raw.quizAdminState);

    return {
        userId,
        email: normalizeString(raw.email, ""),
        firstName: normalizeString(raw.firstName, ""),
        lastName: normalizeString(raw.lastName, ""),
        usn: normalizeString(raw.usn, ""),
        quizState,
        quizAdminState,
        resumeApproved:
            quizState.status === "disqualified" &&
            Boolean(quizState.requestId) &&
            quizAdminState.approvedResumeRequestId === quizState.requestId
    };
}

function getUserRef(userId) {
    return doc(db, USERS_COLLECTION, userId);
}

async function getQuizAccessRecord(userId) {
    if (!userId) {
        return null;
    }

    const snapshot = await getDoc(getUserRef(userId));
    return snapshot.exists() ? normalizeParticipantRecord(snapshot.id, snapshot.data()) : null;
}

async function markQuizDisqualified(user, details = {}) {
    if (!user?.uid) {
        return null;
    }

    const now = new Date().toISOString();
    const quizState = {
        status: "disqualified",
        requestId: createRequestId(),
        disqualifiedAt: now,
        pageLeaveCount: Math.max(0, normalizeNumber(details.pageLeaveCount, 0)),
        reason: normalizeString(details.reason, "page-leave-limit"),
        resumedAt: "",
        updatedAt: now
    };

    await setDoc(
        getUserRef(user.uid),
        {
            quizState
        },
        { merge: true }
    );

    return quizState;
}

async function markQuizResumed(user) {
    if (!user?.uid) {
        return null;
    }

    const now = new Date().toISOString();
    const existingRecord = await getQuizAccessRecord(user.uid);
    const currentQuizState = existingRecord?.quizState || normalizeQuizState();
    const quizState = {
        status: "active",
        requestId: currentQuizState.requestId,
        disqualifiedAt: currentQuizState.disqualifiedAt,
        pageLeaveCount: 0,
        reason: "",
        resumedAt: now,
        updatedAt: now
    };

    await setDoc(
        getUserRef(user.uid),
        {
            quizState
        },
        { merge: true }
    );

    return quizState;
}

async function markQuizSubmitted(user) {
    if (!user?.uid) {
        return null;
    }

    const now = new Date().toISOString();
    const existingRecord = await getQuizAccessRecord(user.uid);
    const currentQuizState = existingRecord?.quizState || normalizeQuizState();
    const quizState = {
        status: "submitted",
        requestId: currentQuizState.requestId,
        disqualifiedAt: currentQuizState.disqualifiedAt,
        pageLeaveCount: 0,
        reason: "",
        resumedAt: currentQuizState.resumedAt,
        updatedAt: now
    };

    await setDoc(
        getUserRef(user.uid),
        {
            quizState
        },
        { merge: true }
    );

    return quizState;
}

async function grantResumeApproval(userId, requestId, adminUser) {
    if (!userId || !requestId) {
        throw new Error("Missing resume approval details.");
    }

    const now = new Date().toISOString();
    const quizAdminState = {
        approvedResumeRequestId: requestId,
        approvedAt: now,
        approvedByUid: normalizeString(adminUser?.uid, ""),
        approvedByEmail: normalizeString(adminUser?.email, ""),
        updatedAt: now
    };

    await setDoc(
        getUserRef(userId),
        {
            quizAdminState
        },
        { merge: true }
    );

    return quizAdminState;
}

async function listDisqualifiedParticipants() {
    const snapshot = await getDocs(query(collection(db, USERS_COLLECTION), where("quizState.status", "==", "disqualified")));

    return snapshot.docs
        .map((docSnapshot) => normalizeParticipantRecord(docSnapshot.id, docSnapshot.data()))
        .sort((left, right) => {
            const rightTime = right.quizState.disqualifiedAt || "";
            const leftTime = left.quizState.disqualifiedAt || "";
            return rightTime.localeCompare(leftTime);
        });
}

function isResumeApproved(record) {
    return Boolean(record?.resumeApproved);
}

export {
    getQuizAccessRecord,
    grantResumeApproval,
    isResumeApproved,
    listDisqualifiedParticipants,
    markQuizDisqualified,
    markQuizResumed,
    markQuizSubmitted
};
