// Folder drag-and-drop wiring shared between chat-sidebar.js's chat
// folders and profiles.js's prompt-profile folders — same event-handler
// logic (drag a folder to reorder it, or drop a leaf item onto it to file
// it there), just against two different state slots. Deliberately has no
// imports, same reasoning as core/html-utils.js: safe to pull into either
// side of a circular-import pair without adding a new dependency edge.
//
// `isLeafDragActive`/`draggedFolderId` are getters (not plain values) so
// callers can pass live `() => state.xyz` reads — this only fires on real
// DOM events, long after any module-evaluation-time state.
export function wireFolderDragAndDrop(folderDiv, folderId, {
  isLeafDragActive,   // () => boolean — a non-folder item drag is in progress, so don't also start a folder drag
  draggedFolderId,    // () => current dragged folder's id, or a falsy value
  startFolderDrag,    // (e, folderId) => void
  onFolderDrop,       // (e, folderId) => void — another folder was dropped here (reorder)
  onItemDrop,         // (e, folderId) => void — a leaf item was dropped here (file it into this folder)
}) {
  folderDiv.draggable = true;
  folderDiv.dataset.folderId = folderId;
  folderDiv.addEventListener('dragstart', e => {
    if (!isLeafDragActive()) {
      e.stopPropagation();
      startFolderDrag(e, folderId);
      folderDiv.classList.add('folder-dragging');
    }
  });
  folderDiv.addEventListener('dragend', () => {
    folderDiv.classList.remove('folder-dragging');
    document.querySelectorAll('.folder-drag-over').forEach(el => el.classList.remove('folder-drag-over'));
  });
  folderDiv.addEventListener('dragover', e => {
    const dragged = draggedFolderId();
    if (dragged && dragged !== folderId) {
      e.preventDefault(); e.stopPropagation();
      folderDiv.classList.add('folder-drag-over');
    }
  });
  folderDiv.addEventListener('dragleave', e => {
    if (!folderDiv.contains(e.relatedTarget)) folderDiv.classList.remove('folder-drag-over');
  });
  folderDiv.addEventListener('drop', e => {
    if (draggedFolderId()) onFolderDrop(e, folderId);
    else onItemDrop(e, folderId);
  });
}
