export type NearbyAddressSnapshot = {
  plz: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;
};

export type NearbyNormalizedGroup = {
  id: string;
  plz: Set<string>;
  streets: Set<string>;
};

export type NearbyMatchSettings = {
  sameStreet: boolean;
  streetGroupsEnabled: boolean;
  samePlz: boolean;
  routeCluster: boolean;
  radiusEnabled: boolean;
  radiusM: number;
};

export function groupAcceptsNearbyAddress(
  group: NearbyNormalizedGroup,
  address: NearbyAddressSnapshot,
) {
  if (group.plz.size === 0 && group.streets.size === 0) return false;

  const plzMatches =
    group.plz.size === 0 || Boolean(address.plz && group.plz.has(address.plz));
  const streetMatches =
    group.streets.size === 0 ||
    Boolean(address.street && group.streets.has(address.street));

  return plzMatches && streetMatches;
}

function distanceMeters(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function rankNearbyDeliveryMatch(input: {
  source: NearbyAddressSnapshot;
  candidate: NearbyAddressSnapshot;
  settings: NearbyMatchSettings;
  groups: NearbyNormalizedGroup[];
  sourceGroupIds: string[];
  sourceCluster: string | null;
  clusterByStreet: Map<string, string>;
}) {
  const {
    source,
    candidate,
    settings,
    groups,
    sourceGroupIds,
    sourceCluster,
    clusterByStreet,
  } = input;

  let rank = 0;
  let matchType = "";

  if (
    settings.sameStreet &&
    source.street &&
    candidate.street === source.street
  ) {
    rank = 500;
    matchType = "same_street";
  }

  if (
    settings.streetGroupsEnabled &&
    sourceGroupIds.length > 0 &&
    groups.some(
      (group) =>
        sourceGroupIds.includes(group.id) &&
        groupAcceptsNearbyAddress(group, candidate),
    ) &&
    rank < 400
  ) {
    rank = 400;
    matchType = "street_group";
  }

  if (
    settings.radiusEnabled &&
    source.lat != null &&
    source.lng != null &&
    candidate.lat != null &&
    candidate.lng != null
  ) {
    const distance = distanceMeters(
      source.lat,
      source.lng,
      candidate.lat,
      candidate.lng,
    );
    if (distance <= settings.radiusM && rank < 350) {
      rank = 350 - Math.min(99, Math.round(distance / 100));
      matchType = "radius";
    }
  }

  if (
    settings.routeCluster &&
    sourceCluster &&
    candidate.street &&
    clusterByStreet.get(candidate.street) === sourceCluster &&
    rank < 300
  ) {
    rank = 300;
    matchType = "route_cluster";
  }

  if (
    settings.samePlz &&
    source.plz &&
    candidate.plz === source.plz &&
    rank < 200
  ) {
    rank = 200;
    matchType = "same_plz";
  }

  return { rank, matchType };
}
