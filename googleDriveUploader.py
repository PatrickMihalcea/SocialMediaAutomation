from pydrive.auth import GoogleAuth 
from pydrive.drive import GoogleDrive

def upload(videoPath):
    gauth = GoogleAuth() 
    drive = GoogleDrive(gauth)
    upload_file_list = [videoPath] 
    for upload_file in upload_file_list: 
        gfile = drive.CreateFile(
            {
            'title': 'AI Generate Houses.mp4',
            'description': '#house, #architecture',
            # Folder location to upload to.
            'parents': [{'id': '1frZ8YVLdyJ6hpsNJ_mYV3I1mYrlt1Ejh'}]
            }
        ) 
        # Read file and set it as the content of this instance. 
        gfile.SetContentFile(upload_file) 
        gfile.Upload() # Upload the file.

