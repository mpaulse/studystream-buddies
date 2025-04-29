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

themeObserver = new MutationObserver(async (mutations) => {
    for (let mutation of mutations) {
        if (mutation.attributeName === "class") {
            const theme = mutation.target.className.includes("dark") ? "dark" : "light";
            if (chrome.runtime.id != null) {
                await chrome.runtime.sendMessage({type: "PAGE_UPDATE_EVENT", theme});
            }
        }
    }
});
themeObserver.observe(document.body, { attributes: true });
