import { Dispatch, ReactElement, SetStateAction, useEffect, useState, useRef } from "react";
import { MessageType } from "../base/base-view";
import {
  RoomData,
  RoomId,
} from "../../models/room";

export interface CellViewProps {
  roomsAllowed: { id: RoomId }[];
  room?: RoomData;
  roomOptions: RoomData[];
  scaleFactor: number;
  setRoomsAllowed: (roomsAllowed: { id: RoomId }[]) => void;
  setMessage: Dispatch<SetStateAction<{ text: string; type: MessageType; }>>;
}

export function CellView({
  roomsAllowed: cellRoomsAllowed,
  room,
  roomOptions,
  scaleFactor,
  setRoomsAllowed,
  setMessage,
}: CellViewProps): ReactElement {

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function getWindowDimensions() {
    const { innerWidth: width, innerHeight: height } = window;
    return {
      width, height
    };
  }

  const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions());

  useEffect(() => {
    function handleResize() {
      setWindowDimensions(getWindowDimensions());
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close dropdown when clicking outside
  useEffect(
    () => {
      function handleClickOutside(event: MouseEvent) {
        if (
          cellRef.current
          && !cellRef.current.contains(event.target as Node)
          && dropdownRef.current
          && !dropdownRef.current.contains(event.target as Node)
        ) {
          setIsDropdownOpen(false);
        }
      }

      if (isDropdownOpen) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    },
    [isDropdownOpen],
  );

  const dropdownText = `${cellRoomsAllowed.length} room${cellRoomsAllowed.length !== 1 ? 's' : ''} allowed`;

  return (
    <div
      className={`cell ${cellRoomsAllowed.length > 0 ? '' : "cell-disabled"}`}
      style={{
        ...(room ? { backgroundColor: room.color } : {}),
        height: `${100 * scaleFactor}%`,
        width: `${100 * scaleFactor}%`,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        className="cell-content"
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        ref={cellRef}
        style={{
          cursor: 'pointer',
          padding: '4px',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {/* Room name (if assigned) */}
        {room && (
          <div
            style={{
              fontSize: `${1 * windowDimensions.width / 256 * scaleFactor}rem`,
              marginBottom: '4px',
              lineHeight: 1.2,
            }}
          >
            {room.name}
          </div>
        )}

        {/* Dropdown indicator */}
        <div
          style={{
            fontSize: `${0.8 * windowDimensions.width / 256 * scaleFactor}rem`,
            display: 'flex',
            alignItems: 'center',
            lineHeight: 1.2,
          }}
        >
          {dropdownText}
          <span style={{ marginLeft: '4px', fontSize: '0.8em' }}>
            {isDropdownOpen ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* Dropdown menu */}
      {isDropdownOpen && (
        <div
          className="dropdown-menu"
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            padding: '4px',
            maxHeight: `${Math.min(roomOptions.length * 30, 200)}px`,
            overflowY: 'auto',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            fontSize: `${0.8 * windowDimensions.width / 256 * scaleFactor}rem`,
          }}
        >
          {roomOptions.map((roomOption, roomIndex) => (
            <label
              key={roomIndex}
              style={{
                display: 'block',
                padding: '2px 4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                value={roomOption.id}
                checked={cellRoomsAllowed.some((room) => room.id === roomOption.id)}
                onChange={(event) => {
                  const isChecked = event.target.checked;
                  let updatedRoomsAllowed = [...cellRoomsAllowed];

                  if (isChecked) {
                    // Add room if not already selected
                    if (!cellRoomsAllowed.some((room) => room.id === roomOption.id)) {
                      updatedRoomsAllowed.push({
                        id: roomOption.id,
                      });
                    }
                  } else {
                    // Remove room
                    updatedRoomsAllowed = updatedRoomsAllowed
                      .filter((room) => room.id !== roomOption.id);
                  }

                  try {
                    setRoomsAllowed(updatedRoomsAllowed);
                  } catch (err) {
                    console.error(err);
                    setMessage({
                      type: MessageType.ERROR,
                      text: String(err),
                    });
                  }
                }}
                style={{ marginRight: '6px' }}
              />
              {roomOption.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
