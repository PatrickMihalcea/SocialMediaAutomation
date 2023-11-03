import cv2
import os
import numpy as np
from moviepy.editor import VideoFileClip, AudioFileClip
import moviepy.video.fx.all as vfx

class videoMaker:
    def __init__(self, folder, secondsPerImage):
        self.image_folder = folder
        self.images = [img for img in os.listdir(self.image_folder) if img.endswith(".jpg")]
        self.images.sort(key=lambda x: int(x.split('_')[1].split('.jpg')[0]))
        self.width, self.height = 1080, 1920
        # Set the output video file name and its parameters
        self.video_name = os.path.join(self.image_folder, 'video.mp4') 
        self.video = cv2.VideoWriter(self.video_name, cv2.VideoWriter_fourcc(*'mp4v'), 1/secondsPerImage, (self.width, self.height))

        # Create the video from images
        for image in self.images:
            img = cv2.imread(os.path.join(self.image_folder, image))
            img_height, img_width, _ = img.shape
            img_aspect_ratio = img_width / img_height
            target_aspect_ratio = self.width / self.height
            
            if img_aspect_ratio > target_aspect_ratio:
                # Crop the sides to fit the target aspect ratio
                crop_width = int(img_height * target_aspect_ratio)
                start_x = (img_width - crop_width) // 2
                img = img[:, start_x:start_x + crop_width]
            else:
                # Crop the top and bottom to fit the target aspect ratio
                crop_height = int(img_width / target_aspect_ratio)
                start_y = (img_height - crop_height) // 2
                img = img[start_y:start_y + crop_height, :]

            # Resize the cropped image to the target dimensions
            img = cv2.resize(img, (self.width, self.height))
            
            self.video.write(img)

        cv2.destroyAllWindows()
        self.video.release()
    
    def addMusic(self, audioPath, start_time):
        audio_clip = AudioFileClip(audioPath)

        # Trim the audio clip to start from a specific time
        video_clip = VideoFileClip(self.video_name)
        audio_clip = audio_clip.subclip(start_time, start_time+video_clip.duration)

        # Ensure the audio duration matches the video duration
        if audio_clip.duration < video_clip.duration:
            audio_clip = audio_clip.crossfadein(self.video.duration)

        # Set the audio of the video to the modified audio clip
        video_clip = video_clip.set_audio(audio_clip)

        # Write the final video to the output file
        video_clip.write_videofile(self.video_name, codec='libx264', audio_codec='aac')

        # Close the video and audio clips
        video_clip.close()
        audio_clip.close()

