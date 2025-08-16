import { Dispatch, ReactElement, SetStateAction } from "react";
import { RoomData } from "../../models/room";
import { MessageType } from "../base/base-view";

interface RoomViewProps {
  children: ReactElement,
  deleteRoom: () => void,
  room: RoomData,
  roomIndex: number,
  setMessage: Dispatch<SetStateAction<{ text: string; type: MessageType; }>>,
  setRoomColor: (newRoomSize: string) => void;
  setRoomName: (newRoomName: string) => void;
  setRoomSize: (newRoomSize: number) => void;
}

export function RoomView({ children, deleteRoom, roomIndex, room, setMessage, setRoomColor, setRoomName, setRoomSize }: RoomViewProps): ReactElement {

  return (
    <div className="card flexbox-row" >
      <div className="labeled-element" >
        <label htmlFor={`room-${roomIndex}-name`}>Room Name</label>
        <input
          id={`room-${roomIndex}-name`}
          onChange={(event) => {
            const newRoomName = event.target.value;
            try {
              setRoomName(newRoomName);
            } catch (err) {
              console.error(err);
              setMessage({
                type: MessageType.ERROR,
                text: String(err),
              });
            }
          }}
          type="text"
          value={room.name}
        />
      </div>
      <div
        className="labeled-element"
      >
        <label htmlFor={`room-${roomIndex}-size`}>Size</label>
        <input
          id={`room-${roomIndex}-size`}
          min={0}
          onChange={(event) => {
            const newRoomSize = Number(event.target.value);
            if (newRoomSize < Number(event.target.min)) {
              setMessage({
                type: MessageType.ERROR,
                text: `The room size ${newRoomSize} is too small.`,
              });
              return;
            }
            try {
              setRoomSize(newRoomSize);
            } catch (err) {
              console.error(err);
              setMessage({
                type: MessageType.ERROR,
                text: String(err),
              });
            }
          }}
          type="number"
          value={room.size}
        />
      </div>
      <div
        className="labeled-element"
      >
        <label htmlFor={`room-${roomIndex}-color`}>Color</label>
        <input
          id={`room-${roomIndex}-color`}
          onChange={(event) => {
            const newRoomColor = event.target.value;
            try {
              setRoomColor(newRoomColor);
            } catch (err) {
              console.error(err);
              setMessage({
                type: MessageType.ERROR,
                text: String(err),
              });
            }
          }}
          type="color"
          value={room.color}
        />
      </div>
      <div
        className="labeled-element"
      >
        <label htmlFor={`room-${roomIndex}-links`}>Links</label>
        {children}
      </div>
      <div
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
        }}
      >
        <div
          className="labeled-element"
        >
          <label htmlFor="room-delete">Delete Room</label>
          <button
            id="room-delete"
            onClick={() => {
              try {
                deleteRoom();
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
    </div>
  );
}
