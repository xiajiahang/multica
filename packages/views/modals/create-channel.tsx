"use client";

import { CreateChannelDialog } from "../channels/components/create-channel-dialog";
import { useModalStore } from "@multica/core/modals";

export function CreateChannelModal() {
  const { data, close } = useModalStore((s) => ({
    data: s.data,
    close: s.close,
  }));

  return (
    <CreateChannelDialog
      open
      onClose={close}
      onSuccess={data?.onSuccess as ((channelId: string) => void) | undefined}
    />
  );
}
