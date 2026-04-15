import { Extension } from "@tiptap/core";

export function createSubmitExtension(onSubmit: () => void, enterToSend = false) {
  return Extension.create({
    name: "submitShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          onSubmit();
          return true;
        },
        ...(enterToSend
          ? {
              Enter: () => {
                onSubmit();
                return true;
              },
            }
          : {}),
      };
    },
  });
}
