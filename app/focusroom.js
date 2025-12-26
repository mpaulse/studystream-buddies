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

if (window.ssBuddiesFocusRoomInitialized == null) {
    window.ssBuddiesFocusRoomInitialized = true;

    const observer = new MutationObserver(mutations => {
        for (let mutation of mutations) {
            if (mutation.type === "attributes") {
                const element = mutation.target
                if (element.nodeName.toLowerCase() === "video") {
                    switch (mutation.attributeName) {
                        case "class":
                            if (element.classList.contains("privacy-blur")) {
                                element.classList.remove("privacy-blur");
                            }
                            break;
                        case "style":
                            let style = element.getAttribute("style") ?? "";
                            if (style.includes("blur(30px)")) {
                                style = style.replace("blur(30px)", "blur(0.301px)");
                                element.setAttribute("style", style);
                            }
                            break;
                    }
                }
            } else if (mutation.type === "childList") {
                for (node of mutation.addedNodes) {
                    if (node.nodeName.toLowerCase() === "video" && node.classList.contains("privacy-blur")) {
                        node.classList.remove("privacy-blur");
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributeFilter: ["class", "style"]
    });

    document.querySelectorAll("video.privacy-blur").forEach(video => {
        video.classList.remove("privacy-blur");
    });
}
