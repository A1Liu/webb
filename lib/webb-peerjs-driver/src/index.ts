import {
  ConnectionDriver,
  ConnectionDriverDefinition,
  ConnectionDriverInit,
  ConnectionRegisterInfo,
  RawDatagram,
  DriverPeerKVStore,
  NetworkContext,
} from "@a1liu/webb-tools/network";

export class PeerjsDriver implements ConnectionDriver {
  static readonly id = "HttpDriver";
  readonly kvStore: DriverPeerKVStore;

  constructor(fields: ConnectionDriverInit) {
    this.kvStore = fields.peerKVStore;

    console.log("creating", fields);
  }

  registerConnection({
    peerDeviceId,
    additionalInfo,
  }: ConnectionRegisterInfo): Promise<{ success: boolean }> {
    console.log("registering ", peerDeviceId, additionalInfo);
    throw new Error("Method not implemented.");
  }
  sendDatagram(datagram: RawDatagram, ctx?: NetworkContext): Promise<void> {
    console.log("Sending ", datagram, ctx);
    throw new Error("Method not implemented.");
  }
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

PeerjsDriver satisfies ConnectionDriverDefinition;
