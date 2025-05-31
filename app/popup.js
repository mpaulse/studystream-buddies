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

chrome.runtime.onMessage.addListener(msg => {
    switch (msg.type) {
        case "LOGIN_EVENT":
            loadBuddies().catch(error => console.error(error));
            break;
        case "LOGOUT_EVENT":
            onLogout();
            break;
        case "THEME_CHANGE_EVENT":
            setTheme(msg.theme);
            break;
        case "USERS_LIST_EVENT":
            showBuddiesPage(msg.users);
            break;
    }
    return false;
});

async function loadBuddies(refresh = false) {
    showLoadingPage();
    await chrome.runtime.sendMessage({ type: "GET_USERS", refresh });
}

function onLogout() {
    showLoginPage();
}

async function onLoginButtonClick() {
    await chrome.tabs.create({ url: "https://app.studystream.live/login" });
}

async function onRefreshButtonClick() {
    await loadBuddies(true);
}

function showPage(pageElement) {
    const root = document.getElementById("root");
    if (root.firstElementChild != null) {
        root.removeChild(root.firstElementChild);
    }
    root.appendChild(pageElement);
}

function showLoginPage() {
    const loginRootElement = document.getElementById("login-template").content.cloneNode(true).firstElementChild;
    const loginButton = loginRootElement.querySelector("#login-button");
    loginButton.addEventListener("click", onLoginButtonClick);
    showPage(loginRootElement);
}

function showLoadingPage() {
    showPage(document.getElementById("loading-template").content.cloneNode(true).firstElementChild);
}

function showNoBuddiesPage() {
    const noBuddiesRootElement = document.getElementById("no-buddies-template").content.cloneNode(true).firstElementChild;
    const refreshButton = noBuddiesRootElement.querySelector(".refresh-button");
    refreshButton.addEventListener("click", onRefreshButtonClick);
    showPage(noBuddiesRootElement);
}

function showBuddiesPage(buddies) {
    const buddyElements = buddies.map(buddy => createBuddyElement(buddy));
    if (buddyElements.length > 0) {
        const buddiesRootElement
            = document.getElementById("buddies-template").content.cloneNode(true).firstElementChild;
        const buddiesListElement = buddiesRootElement.querySelector("#buddies-list");
        buddiesListElement.replaceChildren(...buddyElements);
        const refreshButton = buddiesRootElement.querySelector(".refresh-button");
        refreshButton.addEventListener("click", onRefreshButtonClick);
        showPage(buddiesRootElement);
    } else {
        showNoBuddiesPage();
    }
}

function createBuddyElement(buddy) {
    const buddyElement
        = document.getElementById("buddy-template").content.cloneNode(true).firstElementChild;
    if (buddy.pinner) {
        buddyElement.classList.add("pinner");
    }

    buddyElement.querySelector(".buddy-avatar").src = buddy.avatarUrl;

    if (!buddy.favourite) {
        removeDescendent(buddyElement, ".favourite-indicator");
    }
    if (!buddy.premiumUser) {
        removeDescendent(buddyElement, ".premium-indicator");
    }

    const displayNameElement = buddyElement.querySelector(".buddy-display-name");
    displayNameElement.textContent = buddy.displayName;
    displayNameElement.addEventListener("click", () => {
        chrome.tabs.create({ url: `https://app.studystream.live/profile/${buddy.id}` });
    });
    if (buddy.premiumUser) {
        displayNameElement.classList.add("premium-user");
    }

    buddyElement.querySelector(".buddy-full-name").textContent = `(${buddy.fullName.trim()})`;

    if (buddy.countryCode != null) {
        const flagElement = buddyElement.querySelector(".buddy-country-flag")
        flagElement.title = buddy.countryCode;
        flagElement.src = `https://app.studystream.live/assets/icons/flags/${buddy.countryCode.toLowerCase()}.svg`;
    } else {
        removeDescendent(buddyElement, ".buddy-country-flag");
    }

    if (!buddy.follower) {
        removeDescendent(buddyElement, ".buddy-follower");
    }

    if (!buddy.camEnabled) {
        removeDescendent(buddyElement, ".cam-indicator");
    }

    buddyElement.querySelector(".room-name").textContent = buddy.room.name;

    return buddyElement;
}

function removeDescendent(element, descendentSelector) {
    const descendent = element.querySelector(descendentSelector);
    if (descendent != null) {
        descendent.parentNode.removeChild(descendent);
    }
}

function setTheme(theme) {
    document.body.className = theme;
}

(async () => {
    const theme = await chrome.runtime.sendMessage({ type: "GET_THEME" });
    setTheme(theme);

    const loggedIn = await chrome.runtime.sendMessage({ type: "IS_LOGGED_IN" });
    if (!loggedIn) {
        onLogout();
    } else {
        await loadBuddies();
    }
})();
