export interface FuelAddition {
  wood: number;
  fuel: number;
}

export function planFuelAddition(
  currentFuel: number,
  requestedWood: number,
  availableWood: number,
  maxFuel: number,
  fuelPerWood: number,
): FuelAddition {
  const safeCurrent = Math.max(0, Math.min(maxFuel, Math.floor(currentFuel)));
  const roomForWood = Math.max(0, Math.floor((maxFuel - safeCurrent) / fuelPerWood));
  const wanted = Math.max(1, Math.min(10, Math.floor(requestedWood) || 1));
  const wood = Math.max(0, Math.min(wanted, roomForWood, Math.floor(availableWood)));
  return { wood, fuel: safeCurrent + wood * fuelPerWood };
}

export function consumeFuel(currentFuel: number, amount: number): { consumed: boolean; fuel: number } {
  const current = Math.max(0, Math.floor(currentFuel));
  const wanted = Math.max(1, Math.floor(amount));
  return current < wanted
    ? { consumed: false, fuel: current }
    : { consumed: true, fuel: current - wanted };
}
