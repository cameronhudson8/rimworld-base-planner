import { Dispatch, ReactElement, SetStateAction } from "react";
import { MessageType } from "../base/base-view";
import { RoomData } from "../../models/room";
import { DEFAULT_LINK_WEIGHT } from "../../models/link";

export interface LinkViewProps {
  deleteLink: () => void,
  linkableRooms: RoomData[],
  linkedRoom: RoomData;
  linkIndex: number,
  // Needed?
  roomIndex: number,
  satisfied?: boolean,
  sharedSides?: number,
  weight?: number,
  hard?: boolean,
  setLinkedRoomId: (newLinkedRoomId: string) => void;
  setLinkWeight?: (newWeight: number) => void;
  setLinkHard?: (newHard: boolean) => void;
  setMessage: Dispatch<SetStateAction<{ text: string; type: MessageType; }>>,
}

export function LinkView({
  deleteLink,
  linkableRooms,
  linkedRoom,
  linkIndex,
  roomIndex,
  satisfied,
  sharedSides,
  weight,
  hard,
  setLinkedRoomId,
  setLinkWeight,
  setLinkHard,
  setMessage,
}: LinkViewProps): ReactElement {
  const weightValue = weight ?? DEFAULT_LINK_WEIGHT;
  const hardValue = hard ?? false;
  const statusColor = satisfied === undefined
    ? undefined
    : satisfied ? "#0a8a3a" : "#b00020";
  const statusText = satisfied === undefined
    ? ""
    : satisfied
      ? `✓ adjacent (${sharedSides ?? 0} shared)`
      : "✗ not adjacent";
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
      {setLinkWeight !== undefined && (
        <div className="labeled-element">
          <label htmlFor={`room-${roomIndex}-link-${linkIndex}-weight`}>Weight</label>
          <input
            id={`room-${roomIndex}-link-${linkIndex}-weight`}
            min={0}
            step={0.5}
            type="number"
            value={weightValue}
            onChange={(event) => {
              const newWeight = Number(event.target.value);
              if (!Number.isFinite(newWeight) || newWeight < 0) {
                return;
              }
              try {
                setLinkWeight(newWeight);
              } catch (err) {
                console.error(err);
                setMessage({
                  type: MessageType.ERROR,
                  text: String(err),
                });
              }
            }}
          />
        </div>
      )}
      {setLinkHard !== undefined && (
        <div className="labeled-element">
          <label htmlFor={`room-${roomIndex}-link-${linkIndex}-hard`}>Hard</label>
          <input
            id={`room-${roomIndex}-link-${linkIndex}-hard`}
            type="checkbox"
            checked={hardValue}
            onChange={(event) => {
              try {
                setLinkHard(event.target.checked);
              } catch (err) {
                console.error(err);
                setMessage({
                  type: MessageType.ERROR,
                  text: String(err),
                });
              }
            }}
          />
        </div>
      )}
      {statusText !== "" && (
        <div className="labeled-element">
          <label>Status</label>
          <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
        </div>
      )}
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
