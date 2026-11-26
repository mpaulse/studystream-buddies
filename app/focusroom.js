/*
 * StudyStream Buddies
 * Copyright (C) 2026 Marlon Paulse
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

(() => {
    setupRoom();

    function setupRoom() {
        if (window.__ssBuddies == null) {
            window.__ssBuddies = {
                room: null
            };
            Object.defineProperty(Object.prototype, "room", {
                configurable: true,
                enumerable: false,
                set(value) {
                    if (value?.participantsChanged != null) {
                        window.__ssBuddies.room = value;
                        Object.defineProperty(this, "room", {
                            configurable: true, enumerable: true,
                            get() {
                                return window.__ssBuddies.room;
                            },
                            set(nextValue) {
                                window.__ssBuddies.room = nextValue;
                                installRoomOverrides();
                            }
                        });
                        installRoomOverrides();
                    } else {
                        Object.defineProperty(this, "room", {
                            value, writable: true, configurable: true, enumerable: true,
                        });
                    }
                },
            });
        }
    }

    function installRoomOverrides() {
        let attempts = 0;
        const intervalRef = setInterval(() => {
            if (window.__ssBuddies.room.state === "connected") {
                clearInterval(intervalRef);
                window.__ssBuddies.participantsChangedSub?.unsubscribe();
                window.__ssBuddies.participantsChangedSub =
                    window.__ssBuddies.room.participantsChanged.subscribe(
                        () => updateRoomParticipants())
                updateRoomParticipants();
                overrideHttpResponses();
            } else if (++attempts >= 150) {
                clearInterval(intervalRef);
            }
        }, 200);
    }

    function updateRoomParticipants() {
        window.__ssBuddies.room.remoteParticipants?.forEach(participant => {
            participant.pinCountHidden = false;
            if (participant.userInfo != null) {
                participant.userInfo.whoCanSeeYourVideo = "Everyone";
                if (participant.userInfo.roomSettings != null) {
                    participant.userInfo.roomSettings.disablePinning = false;
                }
            }
        });
    }

    function overrideHttpResponses() {
        if (window.__ssBuddies.httpHooked) {
            return;
        }
        window.__ssBuddies.httpHooked = true;

        const overrides = [
            {
                method: "POST",
                urlSnippet: "/pin",
                status: 200
            },
            {
                method: "POST",
                urlSnippet: "/view/video-tile",
                status: 204
            }
        ]

        const origXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__response_override = overrides.find(o => o.method === method && url.includes(o.urlSnippet));
            return origXhrOpen.call(this, method, url, ...rest);
        };

        const overrideProperty = (name, applyOverride) => {
            const orig = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name);
            Object.defineProperty(XMLHttpRequest.prototype, name, {
                configurable: true,
                enumerable: orig.enumerable,
                get() {
                    return this.__response_override && this.readyState === XMLHttpRequest.DONE
                        ? applyOverride(this.__response_override)
                        : orig.get.call(this);
                },
            });
        };

        overrideProperty("status", (override) => override.status);
    }

})();
