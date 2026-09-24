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
    cleanUpRoom();
    initRoom();

    function initRoom() {
        let attempts = 0;
        const intervalRef = setInterval(() => {
            if (window.LivekitRoom?.state === "connected") {
                clearInterval(intervalRef);
                if (window.ssBuddies == null) {
                    window.ssBuddies = {
                        room: window.LivekitRoom,
                        participantsChangedSub: window.LivekitRoom.participantsChanged.subscribe(() => updateRoomParticipants())
                    }
                    updateRoomParticipants();
                }
            } else if (++attempts >= 150) {
                clearInterval(intervalRef);
            }
        }, 200);
    }

    function updateRoomParticipants() {
        window.ssBuddies?.room?.remoteParticipants?.forEach(participant => {
            participant.pinCountHidden = false;
            if (participant.userInfo != null) {
                participant.userInfo.whoCanSeeYourVideo = "Everyone";
            }
        });
    }

    function cleanUpRoom() {
        if (window.ssBuddies != null) {
            window.ssBuddies.participantsChangedSub?.unsubscribe();
            window.ssBuddies = null;
        }
    }

})();
