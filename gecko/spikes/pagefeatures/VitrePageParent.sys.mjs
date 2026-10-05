// Parent half of the VitrePage window actor (spike). Nothing to do here yet: the chrome layer
// talks to the child with actor.sendQuery().
export class VitrePageParent extends JSWindowActorParent {
  receiveMessage(msg) {
    return undefined;
  }
}
