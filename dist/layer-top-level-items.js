export const LAYER_TOP_LEVEL_ITEMS_HELPER = `
// The number of top-level items of the layers, sublayers included (a count of the layer collections, which read fresh).
function layerTopLevelCount(layers) {
  var total = 0;
  for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    total += layers[layerIndex].pageItems.length;
    total += layerTopLevelCount(layers[layerIndex].layers);
  }
  return total;
}

// The top-level items of the layers in layer order, a layer's own items before its sublayers' (appended to out, which is returned).
function layerTopLevelItems(layers, out) {
  for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    var own = layers[layerIndex].pageItems;
    var ownCount = own.length;
    for (var itemIndex = 0; itemIndex < ownCount; itemIndex++) out.push(own[itemIndex]);
    layerTopLevelItems(layers[layerIndex].layers, out);
  }
  return out;
}
`;
