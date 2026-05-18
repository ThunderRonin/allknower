export const RELATIONSHIP_TYPE_TO_CORE_NAME = {
    ally: "relAlly",
    enemy: "relEnemy",
    rival: "relRival",
    family: "relFamily",
    member_of: "relMemberOf",
    leader_of: "relLeaderOf",
    serves: "relServes",
    located_in: "relLocatedIn",
    originates_from: "relOriginatesFrom",
    participated_in: "relParticipatedIn",
    caused: "relCaused",
    created: "relCreated",
    owns: "relOwns",
    wields: "relWields",
    worships: "relWorships",
    inhabits: "relInhabits",
    related_to: "relRelatedTo",
} as const;

export type CanonicalRelationshipType = keyof typeof RELATIONSHIP_TYPE_TO_CORE_NAME;

export function getCoreRelationName(relationshipType: string): string {
    const relationName = RELATIONSHIP_TYPE_TO_CORE_NAME[relationshipType as CanonicalRelationshipType];
    if (!relationName) throw new Error(`Unknown relationship type: ${relationshipType}`);
    return relationName;
}

export function isCanonicalRelationshipType(value: string): value is CanonicalRelationshipType {
    return value in RELATIONSHIP_TYPE_TO_CORE_NAME;
}
