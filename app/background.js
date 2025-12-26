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
        await onPageLoaded(tab);
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
    return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith("refreshUsers")) {
        await refreshUsers();
    }
});

class PremiumUserFeatureForbidden extends Error {
    constructor(message) {
        super(message);
        this.name = "PremiumUserFeatureForbidden";
    }
}

async function onPageUpdate(event) {
    if (event.theme != null && event.theme !== await getSessionStorageData("theme")) {
        await setSessionStorageData("theme", event.theme);
        chrome.runtime.sendMessage({ type: "THEME_CHANGE_EVENT", theme: event.theme }).catch(() => {});
    }
}

async function isLoggedIn() {
    return await getSessionStorageData("loggedIn");
}

async function onPageLoaded(tab) {
    const token = await getToken();
    const prevLoggedIn = await getSessionStorageData("loggedIn");
    if (token != null) {
        await setSessionStorageData("premiumUser", await isPremiumSubscription(token));
        if (!prevLoggedIn) {
            await onLogin(token);
        }
    } else if (token == null && prevLoggedIn) {
        await onLogout();
    }
    if (tab?.url?.startsWith("https://app.studystream.live/focus/")) {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["focusroom.js"]
        });
    }
}

async function getCurrentRoom() {
    const rooms = await getSessionStorageData("rooms");
    if (rooms != null) {
        const tabs = await chrome.tabs.query({url: "https://app.studystream.live/*"});
        for (let tab of tabs) {
            for (let room of rooms) {
                if (room.url === tab.url) {
                    return room;
                }
            }
        }
    }
    return null;
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
    chrome.runtime.sendMessage({ type: "LOGOUT_EVENT" }).catch(() => {});
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
        if (userList.length > 0) {
            userList.sort((a, b) => {
                if (a.favourite && !b.favourite) {
                    return -1;
                } else if (!a.favourite && b.favourite) {
                    return 1;
                } else {
                    return a.displayName.localeCompare(b.displayName);
                }
            });

            const prevUserList = await getSessionStorageData("usersInRooms");
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
                            message: `${user.displayName} is now online in ${user.room.name}.`
                        });
                    }
                }
            } else {
                const user = userList[0];
                await chrome.notifications.create({
                    type: "basic",
                    iconUrl: user.avatarUrl,
                    title: "StudyStream Buddies",
                    message: `${user.displayName} and others are online in the focus rooms.`
                });
            }
        }

        const pinningUserIds = await checkPinningUsers(token);
        if (pinningUserIds.length > 0) {
            userList.forEach(user => user.pinner = pinningUserIds.includes(user.id));
        }

        await setUserCamStatus(userList, token);

        await setSessionStorageData("usersInRooms", userList);

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

async function checkPinningUsers(token) {
    if ((await getSessionStorageData("premiumUser")) !== true || (await getCurrentRoom()) == null) {
        return [];
    }

    try {
        const pinningUsers = await getPinningUsers(token);
        const prevPinningUserIds = await getSessionStorageData("pinningUserIds");

        let newPinningUsers = pinningUsers;
        if (prevPinningUserIds != null) {
            newPinningUsers = pinningUsers.filter(user => prevPinningUserIds.find(id => id === user.id) == null);
        }
        for (let user of newPinningUsers) {
            await chrome.notifications.create({
                type: "basic",
                iconUrl: user.avatarUrl ?? "images/icon-128.png",
                title: "StudyStream Buddies",
                message: `${user.displayName} is now pinning you.`
            });
        }

        const pinningUserIds = pinningUsers.map(user => user.id);
        await setSessionStorageData("pinningUserIds", pinningUserIds);
        return pinningUserIds;
    } catch (error) {
        if (error instanceof PremiumUserFeatureForbidden) {
            await removeSessionStorageData("premiumUser");
        } else {
            throw error;
        }
    }
}

async function getPinningUsers(token) {
    const response = await fetch(
        "https://api.studystream.live/api/users/me/premium/pinned-by-users-now",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    if (response.status === 403) {
        throw new PremiumUserFeatureForbidden("Failed to retrieve pinning users");
    }
    return response.ok ? await response.json() : [];
}

async function setUserCamStatus(userList, token) {
    if ((await getSessionStorageData("premiumUser")) !== true) {
        return;
    }

    try {
        for (let user of userList) {
            user.camEnabled = await isUserCamEnabled(user.id, token);
        }
    } catch (error) {
        if (error instanceof PremiumUserFeatureForbidden) {
            await removeSessionStorageData("premiumUser");
        } else {
            throw error;
        }
    }
}

async function isUserCamEnabled(userId, token) {
    const response = await fetch(
        `https://api.studystream.live/api/users/${userId}/focus-room/video-sessions`,
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    if (response.status === 403) {
        throw new PremiumUserFeatureForbidden("Failed check if user cam is enabled");
    }
    const videoSessions = response.ok ? await response.json() : [];
    return videoSessions.length > 0 && videoSessions[0].end == null
}

async function getToken() {
    let token = await getStudyStreamLocalStorageData("token");
    if (token != null) {
        await setLocalStorageData("token", token);
    } else {
        token = await getLocalStorageData("token");
    }
    return token;
}

async function getTheme() {
    let theme = await getSessionStorageData("theme");
    if (theme == null) {
        theme = (await getStudyStreamLocalStorageData("theme"))?.toLowerCase() ?? "dark";
        await setSessionStorageData("theme", theme);
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

async function getLocalStorageData(key, sharedWithIncognito = false) {
    if (!sharedWithIncognito && chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    return (await chrome.storage.local.get(key))[key];
}

async function setLocalStorageData(key, value, sharedWithIncognito = false) {
    if (!sharedWithIncognito && chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    await chrome.storage.local.set({ [key]: value });
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
        const rooms = await getRooms();
        user = {
            id: user.id,
            displayName: user.displayName,
            fullName: user.fullName?.trim(),
            countryCode: user.countryTwoLetterCode,
            avatarUrl: user.avatarThumbUrl ?? "images/icon-128.png",
            follower: user.followsMe,
            premiumUser: user.includePremiumFeatures,
            room: rooms?.find(room => room.id === user.currentRoomId),
            timezoneOffset: user.timezoneUtcOffset
        }
    }
    return user;
}

async function getFollowedUsersInRooms(token) {
    const followedUsers = [];
    const rooms = await getRooms();
    if (rooms?.length > 0) {
        const favouriteUserIds = await getFavouriteUserIds(token);
        for (let room of rooms) {
            const followedUserIds = await getFollowedUserIdsInRoom(room.id, token);
            for (let userId of followedUserIds) {
                const user = await getUserInfo(userId, token);
                if (user?.room != null) { // Handle user leaving room just before getUserInfo() is called
                    user.favourite = favouriteUserIds.includes(user.id);
                    followedUsers.push(user);
                }
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

async function getRooms() {
    let rooms = await getSessionStorageData("rooms");
    if (rooms == null || rooms.length === 0) {
        const response = await fetch(
            "https://api.studystream.live/api/focus-rooms/active/web-app-user",
            {method: "GET"});
        rooms = response.ok ? await response.json() : [];
        rooms = rooms.map(room => {
            return {
                id: room.roomId,
                name: room.roomDisplayName,
                url: `https://app.studystream.live${room.roomUrl}`
            };
        });
        await setSessionStorageData("rooms", rooms);
    }
    return rooms;
}

async function getPremiumSubscriptionTierIds(token) {
    let premiumSubTierIds = await getSessionStorageData("premiumSubscriptionTierIds");
    if (premiumSubTierIds == null || premiumSubTierIds.length === 0) {
        const response = await fetch(
            "https://api.studystream.live/api/subscription-tiers/active",
            {method: "GET", headers: { "Authorization": `Bearer ${token}` }});
        const subTiers = response.ok ? await response.json() : [];
        premiumSubTierIds = subTiers.filter(tier => tier.includePremiumFeatures).map(tier => tier.id);
        await setSessionStorageData("premiumSubscriptionTierIds", premiumSubTierIds);
    }
    return premiumSubTierIds;
}

async function isPremiumSubscription(token) {
    const response = await fetch(
        "https://api.studystream.live/api/accounts/me",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    const currentUserInfo = response.ok ? await response.json() : null;
    return currentUserInfo?.subscription?.subscriptionTierId != null
        && (await getPremiumSubscriptionTierIds(token)).includes(currentUserInfo?.subscription?.subscriptionTierId);
}

(async () => {
    await onPageLoaded();
})();
