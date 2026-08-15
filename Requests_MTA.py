import requests

# MTA API Endpoints
EQUIPMENT_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_equipments.json"
ACTIVE_OUTAGE_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json"
UPCOMING_OUTAGE_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_upcoming.json"

def fetch_json(url):
    """Fetches and parses JSON from a given URL."""
    response = requests.get(url)
    response.raise_for_status() # Ensures data was successfully fetched
    return response.json()

def rebuild_elevator_status():
    # 1. Fetch all data
    print("Fetching equipment list...")
    equipments_raw = fetch_json(EQUIPMENT_URL)
    
    print("Fetching active outages...")
    active_outages_raw = fetch_json(ACTIVE_OUTAGE_URL)
    
    print("Fetching upcoming outages...")
    upcoming_outages_raw = fetch_json(UPCOMING_OUTAGE_URL)

    # 2. Build the foundational dictionary keyed by Equipment ID
    # Note: Adjust the dictionary keys based on your initial print inspection of the JSON schema
    equipment_db = {}
    for eq in equipments_raw:
        # We extract the unique equipment code to serve as the primary database key.
        # The equipment feed spells this key all-lowercase.
        eq_id = eq.get('equipmentno')
        if eq_id:
            equipment_db[eq_id] = {
                'details': eq,
                'status': 'OPERATIONAL', 
                'active_outage_details': None,
                'upcoming_outages': []
            }

    # 3. Layer on Active Outages
    # The outage feeds name the same field 'equipment', not 'equipmentno'.
    for outage in active_outages_raw:
        eq_id = outage.get('equipment')
        if eq_id in equipment_db:
            equipment_db[eq_id]['status'] = 'OUT_OF_SERVICE'
            equipment_db[eq_id]['active_outage_details'] = outage

    # 4. Layer on Upcoming Scheduled Work
    for future_outage in upcoming_outages_raw:
        eq_id = future_outage.get('equipment')
        if eq_id in equipment_db:
            equipment_db[eq_id]['upcoming_outages'].append(future_outage)

    return equipment_db

if __name__ == "__main__":
    # Execute the rebuild and store in memory
    system_status = rebuild_elevator_status()
    
    # Example: Print a summarized report of current system outages
    print("\n--- Current System Outages ---")
    for eq_id, data in system_status.items():
        if data['status'] == 'OUT_OF_SERVICE':
            station = data['details'].get('station', 'Unknown Station')
            reason = data['active_outage_details'].get('reason', 'No reason provided')
            print(f"Equipment {eq_id} at {station} is OUT OF SERVICE. Reason: {reason}")