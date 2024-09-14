import {
  ConnectionDriver,
  ConnectionDriverDefinition,
  ConnectionDriverInit,
  ConnectionRegisterInfo,
  Datagram,
  DriverPeerKVStore,
  NetworkContext,
  RawDatagram,
} from "@a1liu/webb-tools/network";

export class HttpDriver implements ConnectionDriver {
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
  sendDatagram<T>(datagram: Datagram<T>, ctx?: NetworkContext): Promise<void> {
    console.log("Sending ", datagram, ctx);
    throw new Error("Method not implemented.");
  }
  receiveDatagram(channel: string, ctx?: NetworkContext): Promise<RawDatagram> {
    console.log("receiving ", channel, ctx);
    throw new Error("Method not implemented.");
  }
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

HttpDriver satisfies ConnectionDriverDefinition;
