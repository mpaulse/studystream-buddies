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

chrome.webNavigation.onCompleted.addListener(
    async () => {
        await handleLoginStatusUpdate();
    },
    { url: [{ hostEquals: "app.studystream.live" }] });

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
    if (alarm.name === getUsersRefreshAlarmName()) {
        await refreshUsers();
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

async function handleLoginStatusUpdate() {
    const token = await getToken();
    const prevLoggedIn = await getSessionStorageData("loggedIn");
    if (token != null && !prevLoggedIn) {
        await handleLogin();
    } else if (token == null && prevLoggedIn) {
        await handleLogout();
    }
}

async function handleLogin() {
    await setSessionStorageData("loggedIn", true);
    chrome.runtime.sendMessage({ type: "LOGIN_EVENT" }).catch(() => {});
    await refreshUsers();
}

async function handleLogout() {
    await stopUsersRefreshAlarm();
    await removeSessionStorageData("loggedIn");
    chrome.runtime.sendMessage({ type: "LOGOUT_EVENT" }).catch(() => {});
}

let userRefreshQueue = null;

async function refreshUsers() {
    if (userRefreshQueue != null) {
        await new Promise(resolve => userRefreshQueue.push(resolve));
        return;
    }

    userRefreshQueue = [];

    try {
        const token = await getToken();
        if (token == null) {
            await handleLogout();
            return;
        }

        await stopUsersRefreshAlarm();
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

        let newUsers = userList;
        if (prevUserList != null) {
            newUsers = userList.filter(user => prevUserList.find(prevUser => prevUser.id === user.id) == null);
        }
        if (newUsers.length > 0) {
            const user = newUsers[0];
            const message =
                newUsers.length === 1
                    ? `${user.displayName} is now online in ${user.room}`
                    : `${user.displayName} and others are now online in the cam rooms`;
            await chrome.notifications.create({
                type: "basic",
                iconUrl: user.avatarUrl,
                title: "StudyStream Buddies",
                message
            });
        }

        await startUsersRefreshAlarm();

        chrome.runtime.sendMessage({type: "USERS_LIST_EVENT", users: userList}).catch(() => {});
    } finally {
        userRefreshQueue.forEach(resolve => resolve());
        userRefreshQueue = null;
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

async function removeSessionStorageData(key, value) {
    if (chrome.extension.inIncognitoContext) {
        key += "-incognito";
    }
    await chrome.storage.session.remove(key);
}

async function getFollowedUserIds(token, lastActiveLimitMsec = undefined) {
    const response = await fetch(
        "https://api.studystream.live/api/followers/i-follow",
        { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
    let followedUsers = response.ok ? await response.json() : [];
    if (lastActiveLimitMsec != null) {
        const nowUtc = new Date();
        followedUsers = followedUsers.filter(
            user => user?.userInfo?.lastActive != null
                && nowUtc - new Date(user.userInfo.lastActive) <= lastActiveLimitMsec);
    }
    return followedUsers.map(user => user?.userInfo?.id);
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
        user = {
            id: user.id,
            displayName: user.displayName,
            fullName: user.fullName?.trim(),
            countryCode: user.countryTwoLetterCode,
            avatarUrl: user.avatarThumbUrl ?? "images/icon-128.png",
            room: user.currentRoomName,
            follower: user.followsMe,
            premiumUser: user.includePremiumFeatures
        }
    }
    return user;
}

async function getFollowedUsersInRooms(token) {
    const favouriteUserIds = await getFavouriteUserIds(token);
    const followedUserIds = await getFollowedUserIds(token, 5 * 60 * 1000);
    const followedUsers = [];
    for (let userId of followedUserIds) {
        const user = await getUserInfo(userId, token);
        if (user != null && user.room != null) {
            user.favourite = favouriteUserIds.includes(userId);
            followedUsers.push(user);
        }
    }
    return followedUsers;
}

async function startUsersRefreshAlarm() {
    await chrome.alarms.create(getUsersRefreshAlarmName(), { delayInMinutes: 5 });
}

async function stopUsersRefreshAlarm() {
    await chrome.alarms.clear(getUsersRefreshAlarmName());
}

function getUsersRefreshAlarmName() {
    let name = "usersRefresh";
    if (chrome.extension.inIncognitoContext) {
        name += "-incognito";
    }
    return name;
}

(async () => {
    await handleLoginStatusUpdate();
})();
