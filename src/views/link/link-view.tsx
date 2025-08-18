import { Dispatch, ReactElement, SetStateAction } from "react";
import { MessageType } from "../base/base-view";
import { RoomData } from "../../models/room";

export interface LinkViewProps {
  deleteLink: () => void,
  linkableRooms: RoomData[],
  linkedRoom: RoomData;
  linkIndex: number,
  // Needed?
  roomIndex: number,
  setLinkedRoomId: (newLinkedRoomId: string) => void;
  setMessage: Dispatch<SetStateAction<{ text: string; type: MessageType; }>>,
}

export function LinkView({ deleteLink, linkableRooms, linkedRoom, linkIndex, roomIndex, setLinkedRoomId, setMessage }: LinkViewProps): ReactElement {
  return (
    <div
      className="flexbox-row"
      key={`room-${roomIndex}-link-${linkIndex}`}
    >
      <div
        className="labeled-element"
      >
        <label htmlFor={`room-${roomIndex}-link-${linkIndex}`}>Other Room Name</label>
        <select
          id={`room-${roomIndex}-link-${linkIndex}`}
          onChange={(event) => {
            const newLinkedRoomId = event.target.value;
            try {
              setLinkedRoomId(newLinkedRoomId);
            } catch (err) {
              console.error(err);
              setMessage({
                type: MessageType.ERROR,
                text: String(err),
              });
            }
          }}
          value={linkedRoom.id}
        >
          {
            // This list must also include the currently linked room,
            // or it won't display as the dropdown's current value.
            [
              linkedRoom,
              ...linkableRooms,
            ]
              .sort((room1, room2) => room1.name > room2.name ? 1 : -1)
              .map((linkableRoom, linkableRoomIndex) => (
                <option
                  value={linkableRoom.id}
                  key={`room-${roomIndex}-link-${linkIndex}-linkable-room-${linkableRoomIndex}`}
                >
                  {linkableRoom.name}
                </option>
              ))
          }
        </select>
      </div>
      <div
        className="labeled-element"
      >
        <label htmlFor="link-delete">Delete Link</label>
        <button
          id="link-delete"
          onClick={() => {
            try {
              deleteLink();
            } catch (err) {
              console.error(err);
              setMessage({
                type: MessageType.ERROR,
                text: String(err),
              });
            }
          }}
        >
          -
        </button>
      </div>
    </div>
  );

}
