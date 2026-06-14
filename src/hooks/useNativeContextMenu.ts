import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';

type NativeContextMenuOptions = {
  respectExistingHandlers?: boolean;
};

export function useNativeContextMenu(options: NativeContextMenuOptions = {}) {
  return useCallback(async (event: MouseEvent) => {
    if (options.respectExistingHandlers !== false && event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();


    try {
      const cutItem = await PredefinedMenuItem.new({ item: 'Cut' });
      const copyItem = await PredefinedMenuItem.new({ item: 'Copy' });
      const pasteItem = await PredefinedMenuItem.new({ item: 'Paste' });
      const selectAllItem = await PredefinedMenuItem.new({ item: 'SelectAll' });

      const contextMenu = await Menu.new({
        items: [cutItem, copyItem, pasteItem, selectAllItem],
      });

      await contextMenu.popup();
    } catch (error) {
      console.error('OS Menu Binding Error:', error);
    }
  }, [options.respectExistingHandlers]);
}
