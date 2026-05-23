import type { RoomDirectory } from './directory';
import { HttpRoomDirectory } from './httpDirectory';
import { LocalRoomDirectory } from './localDirectory';
import { SpacetimeRoomDirectory } from './spacetimeDirectory';

export type DirectoryRuntime = {
  directory: RoomDirectory;
  label: string;
};

export function createRoomDirectory(): DirectoryRuntime {
  const driver = import.meta.env.VITE_DIRECTORY_DRIVER as string | undefined;
  const stdbDatabase = (import.meta.env.VITE_STDB_DATABASE ?? import.meta.env.VITE_STDB_MODULE) as string | undefined;
  if (driver === 'spacetime' || stdbDatabase) {
    if (!stdbDatabase) {
      throw new Error('VITE_STDB_DATABASE is required when VITE_DIRECTORY_DRIVER=spacetime');
    }
    const uri = (import.meta.env.VITE_STDB_URI as string | undefined) ?? 'https://maincloud.spacetimedb.com';
    return {
      directory: new SpacetimeRoomDirectory({ uri, database: stdbDatabase }),
      label: `STDB ${stdbDatabase}`,
    };
  }

  const remoteUrl = import.meta.env.VITE_DIRECTORY_URL as string | undefined;
  if (remoteUrl) {
    return {
      directory: new HttpRoomDirectory(remoteUrl),
      label: `remote directory ${new URL(remoteUrl).host}`,
    };
  }
  return {
    directory: new LocalRoomDirectory(),
    label: 'local browser directory',
  };
}
