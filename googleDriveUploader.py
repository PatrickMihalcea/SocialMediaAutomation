from pydrive.auth import GoogleAuth 
from pydrive.drive import GoogleDrive

def upload(videoPath):
    gauth = GoogleAuth() 
    drive = GoogleDrive(gauth)
    upload_file_list = [videoPath] 
    for upload_file in upload_file_list: 
        gfile = drive.CreateFile(
            {
            'title': 'AI Generated Architecture.mp4',
            'description': """#Architecture, #HomeDesign, #InteriorDesign, #DreamHome,
                         #HomeDecor, #HouseGoals, #HomeInspo, #HomeTour, #DIYHome, #ModernArchitecture,
                         #HomeImprovement, #LuxuryHomes, #HomeIdeas, #ArchitecturalDesign, #BeautifulHomes,
                         #HouseHunting, #HomeMakeover, #TinyHomes, #Renovation, #Architects, #HomeRenovation,
                         #CottageCore, #SustainableLiving, #GardenDesign, #HomeSweetHome, #MinimalistHome, 
                         #HomeGoals, #EcoFriendlyHomes, #RusticCharm, #FarmhouseStyle, #InteriorStyling, 
                         #CozyHome, #UrbanLiving, #VintageDecor, #SmartHome, #AffordableHomes, #HomeInspiration, 
                         #ScandinavianDesign, #BohoHome, #TinyHouseMovement, #HomesteadLife, #MidCenturyModern, 
                         #SmallSpaces, #HomeOrganization, #OpenConcept, #HomeMakeovers, #HomeOffice, #HomeTrends, 
                         #HomeFurnishings, #FamilyHomes, #HomeGardening, #fyp, #trending""",
            # Folder location to upload to.
            'parents': [{'id': '1frZ8YVLdyJ6hpsNJ_mYV3I1mYrlt1Ejh'}]
            }
        ) 
        # Read file and set it as the content of this instance. 
        gfile.SetContentFile(upload_file) 
        gfile.Upload() # Upload the file.

