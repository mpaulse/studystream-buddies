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

const classObserver = new MutationObserver(mutations => {
    for (let mutation of mutations) {
        if (mutation.target.nodeName.toLowerCase() === "video"
                && mutation.target.classList.contains("privacy-blur")) {
            mutation.target.classList.remove("privacy-blur");
        }
    }
});

classObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributeFilter: ["class"]
});
