/*
 * StudyStream Buddies
 * Copyright (C) 2025 Marlon Paulse
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url?.startsWith("https://app.studystream.live")) {
        await onPageLoaded();
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case "PAGE_UPDATE_EVENT":
            onPageUpdate(msg).catch(error => console.error(error));
            break;
        case "IS_LOGGED_IN":
            isLoggedIn().then(result => sendResponse(result)).catch(error => console.error(error));
            return true;
        case "GET_THEME":
            getTheme().then(result => sendResponse(result)).catch(error => console.error(error));
            return true;
        case "GET_USERS":
            getUsers(msg.refresh).then(result => sendResponse(result)).catch(error => console.error(error));
            return true;
    }

    sendResponse();
    return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith("refreshUsers")) {
        await refreshUsers();
    } else if (alarm.name.startsWith("checkPinningUsers")) {
        await checkPinningUsers();
    }
});

async function onPageUpdate(event) {
    if (event.theme != null && event.theme !== await getSessionStorageData("theme")) {
        await setSessionStorageData("theme", event.theme);
        chrome.runtime.sendMessage({ type: "THEME_CHANGE_EVENT", theme: event.theme }).catch(() => {});
    }
}

async function isLoggedIn() {
    return await getSessionStorageData("loggedIn");
}

async function onPageLoaded() {
    const token = await getToken();
    const prevLoggedIn = await getSessionStorageData("loggedIn");
    if (token != null) {
        if (!prevLoggedIn) {
            await onLogin(token);
        }

        const currentUser = await getCurrentUserInfo(token);
        await setSessionStorageData("premiumUser", currentUser.premiumUser);

        const prevRoomId = await getSessionStorageData("roomId");
        if (currentUser.room?.id != null && currentUser.room.id !== prevRoomId) {
            await onRoomEntered(currentUser.room.id, token);
        } else if (currentUser.room?.id == null && prevRoomId != null) {
            await onRoomExit();
        }
    } else if (token == null && prevLoggedIn) {
        await onLogout();
    }
}

async function onLogin(token) {
    await setSessionStorageData("loggedIn", true);
    chrome.runtime.sendMessage({ type: "LOGIN_EVENT" }).catch(() => {});
    await refreshUsers(token);
}

async function onLogout() {
    await chrome.alarms.clearAll();
    await removeSessionStorageData("loggedIn");
    await removeSessionStorageData("premiumUser");
    await removeSessionStorageData("roomId");
    chrome.runtime.sendMessage({ type: "LOGOUT_EVENT" }).catch(() => {});
}

async function onRoomEntered(roomId, token) {
    await setSessionStorageData("roomId", roomId);
    await checkPinningUsers(token);
}

async function onRoomExit() {
    await stopAlarm("checkPinningUsers");
    await removeSessionStorageData("roomId");
}

let usersRefreshQueue = null;

async function refreshUsers(token = null) {
    if (usersRefreshQueue != null) {
        await new Promise(resolve => usersRefreshQueue.push(resolve));
        return;
    }

    usersRefreshQueue = [];

    try {
        if (token == null) {
            token = await getToken();
            if (token == null) {
                await onLogout();
                return;
            }
        }

        await stopAlarm("refreshUsers");
        const userList = await getFollowedUsersInRooms(token);
        userList.sort((a, b) => {
            if (a.favourite && !b.favourite) {
                return -1;
            } else if (!a.favourite && b.favourite) {
                return 1;
            } else {
                return a.displayName.localeCompare(b.displayName);
            }
        })

        const prevUserList = await getSessionStorageData("usersInRooms");
        await setSessionStorageData("usersInRooms", userList);

        if (prevUserList != null) {
            const updatedUsers = userList.filter(user => {
                const prevUserInfo = prevUserList.find(prevUser => prevUser.id === user.id)
                return prevUserInfo == null || prevUserInfo.room?.id !== user.room?.id;
            });
            for (let user of updatedUsers) {
                if (user.favourite) {
                    await chrome.notifications.create({
                        type: "basic",
                        iconUrl: user.avatarUrl,
                        title: "StudyStream Buddies",
                        message: `${user.displayName} is now online in ${user.room.name}`
                    });
                }
            }
        } else {
            const user = userList[0];
            await chrome.notifications.create({
                type: "basic",
                iconUrl: user.avatarUrl,
                title: "StudyStream Buddies",
                message: `${user.displayName} and others are online in the cam rooms`
            });
        }

        await startAlarm("refreshUsers");

        chrome.runtime.sendMessage({type: "USERS_LIST_EVENT", users: userList}).catch(() => {});
    } finally {
        usersRefreshQueue.forEach(resolve => resolve());
        usersRefreshQueue = null;
    }
}

async function getUsers(refresh) {
    if (refresh) {
        refreshUsers().catch(error => console.error(error));
    } else {
        const users = await getSessionStorageData("usersInRooms");
        if (users != null) {
            chrome.runtime.sendMessage({type: "USERS_LIST_EVENT", users}).catch(() => {});
        }
    }
}

async function checkPinningUsers(token = null) {
    if ((await getSessionStorageData("premiumUser")) !== true) {
        return;
    }
    if (token == null) {
        token = await getToken();
        if (token == null) {
            return;
        }
    }

    await stopAlarm("checkPinningUsers");

    const pinningUsers = await getPinningUsers(token);
    const prevPinningUserIds = await getSessionStorageData("pinningUserIds");
    await setSessionStorageData("pinningUserIds", pinningUsers.map(user => user.id));

    let newPinningUsers = pinningUsers;
    if (prevPinningUserIds != null) {
        newPinningUsers = pinningUsers.filter(user => prevPinningUserIds.find(id => id === user.id) == null);
    }
    for (let user of newPinningUsers) {
        await chrome.notifications.create({
            type: "basic",
            iconUrl: user.avatarUrl ?? "images/icon-128.png",
            title: "StudyStream Buddies",
            message: `${user.displayName} is now pinning you`
        });
    }

    await startAlarm("checkPinningUsers");
}

async function getPinningUsers(token) {
    const response = await fetch(
        "https://api.studystream.live/api/users/me/premium/pinned-by-users-now",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    return response.ok ? await response.json() : [];
}

async function getToken() {
    return await getStudyStreamLocalStorageData("token");
}

async function getTheme() {
    let theme = await getSessionStorageData("theme");
    if (theme == null) {
        theme = (await getStudyStreamLocalStorageData("theme"))?.toLowerCase();
        if (theme != null) {
            await setSessionStorageData("theme", theme);
        }
    }
    return theme;
}

async function getStudyStreamLocalStorageData(key) {
    let value = null;
    const tabs = await chrome.tabs.query({ url: "https://app.studystream.live/*" });
    for (let tab of tabs) {
        if (tab.incognito === chrome.extension.inIncognitoContext) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [ key ],
                func: (key) => {
                    return localStorage.getItem(key);
                }
            });
            if (results.length > 0) {
                value = results[0].result;
                break;
            }
        }
    }
    return value;
}

async function getSessionStorageData(key) {
    if (chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    return (await chrome.storage.session.get(key))[key];
}

async function setSessionStorageData(key, value) {
    if (chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    await chrome.storage.session.set({ [key]: value });
}

async function removeSessionStorageData(key) {
    if (chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    await chrome.storage.session.remove(key);
}

async function getFollowedUserIdsInRoom(roomId, token) {
    const response = await fetch(
        `https://api.studystream.live/api/livekit/${roomId}/suggestions/followed-users`,
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    return response.ok ? await response.json() : [];
}

async function getFavouriteUserIds(token) {
    const response = await fetch(
        "https://api.studystream.live/api/user-favorites",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    const favourites = response.ok ? await response.json() : [];
    return favourites.map(user => user?.favoriteUser?.id).filter(id => id != null);
}

async function getUserInfo(userId, token) {
    const response = await fetch(
        `https://api.studystream.live/api/users/${userId}`,
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    let user = response.ok ? await response.json() : null;
    if (user != null) {
        const rooms = await getSessionStorageData("rooms");
        user = {
            id: user.id,
            displayName: user.displayName,
            fullName: user.fullName?.trim(),
            countryCode: user.countryTwoLetterCode,
            avatarUrl: user.avatarThumbUrl ?? "images/icon-128.png",
            follower: user.followsMe,
            premiumUser: user.includePremiumFeatures,
            room: rooms?.find(room => room.id === user.currentRoomId)
        }
    }
    return user;
}

async function getFollowedUsersInRooms(token) {
    const followedUsers = [];
    const rooms = await getSessionStorageData("rooms");
    if (rooms?.length > 0) {
        const favouriteUserIds = await getFavouriteUserIds(token);
        for (let room of rooms) {
            const followedUserIds = await getFollowedUserIdsInRoom(room.id, token);
            for (let userId of followedUserIds) {
                const user = await getUserInfo(userId, token);
                user.favourite = favouriteUserIds.includes(user.id);
                followedUsers.push(user);
            }
        }
    }
    return followedUsers;
}

async function startAlarm(alarmName, delayInMinutes = 1) {
    if (chrome.extension.inIncognitoContext) {
        alarmName += "-incognito";
    }
    await chrome.alarms.create(alarmName, { delayInMinutes });
}

async function stopAlarm(alarmName) {
    if (chrome.extension.inIncognitoContext) {
        alarmName += "-incognito";
    }
    await chrome.alarms.clear(alarmName);
}

async function getRoomInfo() {
    const response = await fetch(
        "https://api.studystream.live/api/focus-rooms/active/web-app-user",
        { method: "GET" });
    const roomInfo = response.ok ? await response.json() : [];
    const rooms = [];
    roomInfo.forEach(room => {
       rooms.push({
           id: room.roomId,
           name: room.roomDisplayName,
           url: room.roomUrl
       });
    });
    await setSessionStorageData("rooms", rooms);
}

async function getCurrentUserInfo(token) {
    const response = await fetch(
        "https://api.studystream.live/api/accounts/me",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    return response.ok ? await getUserInfo((await response.json()).id, token) : null;
}

(async () => {
    await getRoomInfo();
    await onPageLoaded();
})();
