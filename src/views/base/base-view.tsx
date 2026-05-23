import { ReactElement, useState } from "react";

import { CellView } from '../cell';
import {
  Base,
  BaseData,
  baseDataSchema,
  Room,
} from "../../models";
import { RoomView } from "../room";
import { LinkView } from "../link/link-view";
import { RoomId } from "../../models/room";

export enum MessageType {
  ERROR = "ERROR",
  INFO = "INFO",
};

export function BaseView(): ReactElement {

  // 1. Read state from local storage (and validate it).
  // 2. If there is was not [valid] local storage data, use the default base.
  // 3. Wait for user input.
  // 4. Upon user input, begin reconciliation.
  // 5. Save all changes to the "database" (and then to local storage).
  // 6. Call setState with the updated state.

  const LOCAL_STORAGE_KEY = "base";
  const existingBaseData = (() => {
    const localStorageString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (localStorageString === null) {
      return undefined;
    }
    const localStorageObject = (() => {
      try {
        return JSON.parse(localStorageString)
      } catch (err) {
        console.warn(`The localStorage data for key '${LOCAL_STORAGE_KEY}' was not parseable as JSON: '${JSON.stringify(err)}'`);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return undefined;
      }
    })();
    const { error, value } = baseDataSchema.validate(localStorageObject);
    if (error !== undefined) {
      console.warn(`The localStorage data for key '${LOCAL_STORAGE_KEY}' failed validation as BaseData: '${JSON.stringify(error)}'`);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      return undefined;
    }
    return value;
  })();

  const [baseData, _setBaseData] = useState(existingBaseData ?? _createDefaultBase());
  const setBaseData = (newValue: BaseData) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newValue));
    return _setBaseData(newValue);
  };
  const base = new Base(baseData);

  const [message, setMessage] = useState<{
    text: string,
    type: MessageType,
  }>({
    text: "Ready.",
    type: MessageType.INFO,
  });

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<{ done: number, total: number } | null>(null);

  return (
    <div>
      <div className="cell-grid">
        <h2>Base</h2>
        {
          base.cells.map((cellRow, i) => (
            <div
              className="cell-row"
              key={String(i)}
            >
              {
                cellRow.map((cell, j) => {
                  // The cellSpec of the Base (base.cells[][]) will contain roomIds
                  // if cells have been explicitly assigned to rooms by the user,
                  // but not for those cells that have been auto-assigned to rooms.
                  // We can get the final room assignments (explicit + automatic) from base.cells[][].spec.
                  const roomId = cell.roomId;
                  const room = base.rooms.find((room) => room.id === roomId);
                  const roomOptions = base.rooms;

                  return (
                    <CellView
                      room={room}
                      key={j}
                      roomOptions={roomOptions}
                      roomsAllowed={base.cells[i][j].roomsAllowed}
                      scaleFactor={base.cells.length <= 0 ? 1 : 1 / base.cells.length}
                      setMessage={setMessage}
                      setRoomsAllowed={(roomsAllowed: { id: RoomId }[]) => {
                        const roomsAllowedValidated: { id: RoomId }[] = roomsAllowed.map((room) => ({ id: room.id }));
                        base.cells[i][j].roomsAllowed = roomsAllowedValidated;
                        setBaseData(base);
                      }}
                    />
                  );
                })
              }
            </div>
          ))
        }
      </div>
      {
        (() => {
          const errors: string[] = [
            ...(message.type === 'ERROR' ? [message.text] : []),
            ...base.errors
              .map((errorWithCode) => Object.values(errorWithCode))
              .flat(),
          ];
          if (errors.length > 0) {
            return errors.map((errorMessage, e) => (
              <p
                className="error"
                key={e}
              >
                {errorMessage}
              </p>
            ));
          }
          return (<p> {message.text}</p>);
        })()
      }

      <button
        disabled={isOptimizing}
        onClick={async () => {
          setIsOptimizing(true);
          setOptimizeProgress({ done: 0, total: 0 });
          setMessage({
            type: MessageType.INFO,
            text: "Optimizing...",
          });
          try {
            await base.optimizeAsync({
              onProgress: (done, total) => {
                setOptimizeProgress({ done, total });
                setMessage({
                  type: MessageType.INFO,
                  text: `Optimizing... restart ${done}/${total}`,
                });
              },
            });
            setBaseData(base);
            setMessage({
              type: MessageType.INFO,
              text: 'Optimization complete.',
            });
          } catch (err) {
            console.error(err);
            setMessage({
              type: MessageType.ERROR,
              text: String(err),
            });
          } finally {
            setIsOptimizing(false);
            setOptimizeProgress(null);
          }
        }}
      >
        {isOptimizing && optimizeProgress
          ? (optimizeProgress.total > 0
            ? `Optimizing... ${optimizeProgress.done}/${optimizeProgress.total}`
            : 'Optimizing...')
          : 'Optimize'}
      </button>
      <button
        onClick={() => {
          const agreed = window.confirm("WARNING: This will permanently delete the existing Base. Continue?");
          if (agreed !== true) {
            return;
          }
          try {
            setBaseData(_createDefaultBase());
          } catch (err) {
            console.error(err);
            setMessage({
              type: MessageType.ERROR,
              text: String(err),
            });
          }
        }}
      >
        Reset
      </button>
      <p>Current energy: {
        base.energy.toLocaleString(
          undefined,
          {
            minimumSignificantDigits: 4,
            maximumSignificantDigits: 4,
          }
        )
      }</p>
      {base.linkReports.length > 0 && (() => {
        const roomName = (id: string) => base.rooms.find((rm) => rm.id === id)?.name ?? id;
        const unsatisfied = base.linkReports.filter((rep) => !rep.satisfied);
        const satisfied = base.linkReports.filter((rep) => rep.satisfied);
        return (
          <div className="card flexbox-column">
            <h3>Adjacency Report</h3>
            <p>
              {satisfied.length} of {base.linkReports.length} link(s) share at least one wall.
            </p>
            {unsatisfied.length > 0 && (
              <ul style={{ marginTop: 0 }}>
                {unsatisfied.map((rep, idx) => (
                  <li
                    key={`unsat-${idx}`}
                    style={{ color: rep.hard ? "#b00020" : "#a06000" }}
                  >
                    {rep.hard ? "[HARD] " : ""}
                    {roomName(rep.roomIds[0])} ↔ {roomName(rep.roomIds[1])}
                    {" "}(weight {rep.weight}) — not adjacent
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}
      <h2>Base Configuration</h2>
      <div className="card flexbox-column">
        <div
          className="labeled-element"
        >
          <label htmlFor="size">Size</label>
          <input
            id="size"
            min={0}
            onChange={(event) => {
              const newBaseSize = Number(event.target.value);
              if (newBaseSize < Number(event.target.min)) {
                return;
              }
              try {
                base.setSize(newBaseSize);
                setBaseData(base);
              } catch (err) {
                console.error(err);
                setMessage({
                  type: MessageType.ERROR,
                  text: String(err),
                });
              }
            }}
            onWheel={(event) => {
              event.preventDefault();
            }}
            type="number"
            value={base.cells.length}
          />
        </div>
      </div>
      <h2>Room Configuration</h2>
      <div>
        {
          base.rooms
            .map((room, r) => {
              let assignedCells = 0;
              for (const row of base.cells) {
                for (const cell of row) {
                  if (cell.roomId === room.id) assignedCells += 1;
                }
              }
              return (
              <RoomView
                assignedCells={assignedCells}
                deleteRoom={() => {
                  base.deleteRoom(r);
                  setBaseData(base);
                }}
                key={r}
                room={room}
                roomIndex={r}
                setMessage={setMessage}
                setRoomColor={(newRoomColor: string) => {
                  base.setRoomColor(r, newRoomColor);
                  setBaseData(base);
                }}
                setRoomName={(newRoomName: string) => {
                  base.setRoomName(r, newRoomName);
                  setBaseData(base);
                }}
                setRoomSize={(newRoomSize: number) => {
                  base.setRoomSize(r, newRoomSize);
                  setBaseData(base);
                }}
              >
                {
                  (() => {
                    const currentLinks = base.links
                      .filter((link) => link.roomIds[0] === room.id || link.roomIds[1] === room.id)
                    const currentlyLinkedRooms = currentLinks
                      .map((link) => link.roomIds[0] === room.id ? link.roomIds[1] : link.roomIds[0])
                      .map((otherRoomId) => {
                        const otherRoom = base.rooms.find((otherRoom) => otherRoom.id === otherRoomId);
                        if (otherRoom === undefined) {
                          throw new Error(`Room '${room.name}' has a link to a room with ID '${otherRoomId}', but there is no such room.`)
                        }
                        return otherRoom;
                      });
                    const linkableRooms = base.rooms
                      .filter((otherRoom) => otherRoom.id !== room.id)
                      .filter((otherRoom) => !currentlyLinkedRooms.some((currentlyLinkedRoom) => currentlyLinkedRoom.id === otherRoom.id))
                    return (
                      <div
                        id={`room-${r}-links`}
                        style={{
                          paddingLeft: "1vmin",
                          paddingTop: "1vmin",
                        }}
                      >
                        {
                          currentLinks.map((link, linkIndex) => {
                            const linkedRoomId = link.roomIds[0] === room.id ? link.roomIds[1] : link.roomIds[0];
                            const linkedRoom = base.rooms.find((otherRoom) => otherRoom.id === linkedRoomId);
                            if (linkedRoom === undefined) {
                              throw new Error(`Room '${room.name}' has a link to a room with ID '${linkedRoomId}', but there is no such room.`)
                            }
                            const report = base.linkReports.find((rep) =>
                              (rep.roomIds[0] === link.roomIds[0] && rep.roomIds[1] === link.roomIds[1])
                              || (rep.roomIds[0] === link.roomIds[1] && rep.roomIds[1] === link.roomIds[0])
                            );
                            return (
                              <LinkView
                                deleteLink={() => {
                                  base.deleteLink(base.links.indexOf(link));
                                  setBaseData(base);
                                }}
                                key={linkIndex}
                                linkableRooms={linkableRooms}
                                linkedRoom={linkedRoom}
                                linkIndex={linkIndex}
                                roomIndex={r}
                                weight={link.weight}
                                hard={link.hard}
                                satisfied={report?.satisfied}
                                sharedSides={report?.sharedSides}
                                setLinkedRoomId={(newLinkedRoomId: string) => {
                                  const linkIndexInBaseSpec = base.links.indexOf(link);
                                  // The ternaries below are to avoid swapping rooms 0 and 1 inadvertently.
                                  // We just want to update the one room that has changed.
                                  base.setLinkRoomIds(linkIndexInBaseSpec, {
                                    0: link.roomIds[0] === room.id ? link.roomIds[0] : newLinkedRoomId,
                                    1: link.roomIds[1] === room.id ? link.roomIds[1] : newLinkedRoomId,
                                  });
                                  setBaseData(base);
                                }}
                                setLinkWeight={(newWeight: number) => {
                                  const linkIndexInBaseSpec = base.links.indexOf(link);
                                  base.setLinkWeight(linkIndexInBaseSpec, newWeight);
                                  setBaseData(base);
                                }}
                                setLinkHard={(newHard: boolean) => {
                                  const linkIndexInBaseSpec = base.links.indexOf(link);
                                  base.setLinkHard(linkIndexInBaseSpec, newHard);
                                  setBaseData(base);
                                }}
                                setMessage={setMessage}
                              >
                              </LinkView>
                            );
                          })
                        }
                        <div
                          className="labeled-element"
                        >
                          <label htmlFor="link-add">Add Link</label>
                          <button
                            disabled={linkableRooms.length <= 0}
                            id="link-add"
                            onClick={() => {
                              const otherRoomId = linkableRooms[0].id;
                              try {
                                base.addLink({
                                  0: room.id,
                                  1: otherRoomId,
                                });
                                setBaseData(base);
                              } catch (err) {
                                console.error(err);
                                setMessage({
                                  type: MessageType.ERROR,
                                  text: String(err),
                                });
                              }
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })()}
              </RoomView>
              );
            })
        }
        <div
          className="labeled-element"
        >
          <label htmlFor="room-add">Add Room</label>
          <button
            id="room-add"
            onClick={() => {
              try {
                base.addRoom(new Room());
                setBaseData(base);
              } catch (err) {
                console.error(err);
                setMessage({
                  type: MessageType.ERROR,
                  text: String(err),
                });
              }
            }}
          >
            +
          </button>
        </div>
      </div>
    </div >
  );

}

function _createDefaultBase(): Base {
  const bedroom = new Room({
    color: "#048a49",
    name: "bedroom 1",
    size: 1,
  });
  const kitchen = new Room({
    color: "#ff7373",
    name: "kitchen",
    size: 1,
  });
  const storage = new Room({
    color: "#fc8332",
    name: "storage",
    size: 1,
  });
  const rooms = [
    bedroom,
    kitchen,
    storage,
  ];
  const links = [
    {
      roomIds: {
        0: kitchen.id,
        1: storage.id,
      },
    }
  ];
  const base = new Base({
    cells: [
      [
        {
          roomsAllowed: [],
        },
        {
          roomsAllowed: [],
        },
        {
          roomsAllowed: rooms.map((room) => ({ id: room.id })),
        },
      ],
      [
        {
          roomsAllowed: rooms.map((room) => ({ id: room.id })),
        },
        {
          roomsAllowed: [],
        },
        {
          roomsAllowed: rooms.map((room) => ({ id: room.id })),
        },
      ],
      [
        {
          roomsAllowed: rooms.map((room) => ({ id: room.id })),
        },
        {
          roomsAllowed: [],
        },
        {
          roomsAllowed: [],
        },
      ],
    ],
    links,
    rooms,
  });
  return base;
}
