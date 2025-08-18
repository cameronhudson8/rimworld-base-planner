import {
  BaseData,
  validate,
} from './base';
import { Room } from './room';

describe('Base', () => {

  let baseData: BaseData;

  beforeEach(() => {
    const bedroom = new Room({
      color: "#000000",
      name: 'bedroom-0',
      size: 1,
    });
    const kitchen = new Room({
      color: "#123456",
      name: 'kitchen-0',
      size: 1,
    });
    const storage = new Room({
      color: "#FFFFFF",
      name: 'storage-0',
      size: 2,
    });
    const rooms = [
      bedroom,
      kitchen,
      storage,
    ];
    baseData = {
      cells: [
        [
          {
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
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
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
          },
        ],
      ],
      links: [
        {
          roomIds: {
            0: kitchen.id,
            1: storage.id,
          },
        },
      ],
      rooms,
    };
  });

  test('validation works', () => {
    const baseObject = JSON.parse(JSON.stringify(baseData));
    const baseData2 = validate(baseObject)
    expect(baseData2).toMatchObject(baseData);
  });

});
