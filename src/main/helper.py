import os
from PIL import Image

def renameToJPEG(folder):
    valid_extensions = ('.png', '.jpg', '.webp', '.tiff', '.bmp', '.gif')

    for filename in os.listdir(folder):
        if filename.lower().endswith(valid_extensions):
            original_path = os.path.join(folder, filename)
            new_filename = os.path.splitext(filename)[0] + '.jpeg'
            new_path = os.path.join(folder, new_filename)

            try:
                image = Image.open(original_path).convert('RGB')
                image.save(new_path, 'JPEG')
                os.remove(original_path)
            except Exception as e:
                print(f"Failed to convert {filename}: {e}")

def rotateImageClockwise(imageURL):
    image = Image.open(imageURL)
    rotatedImage = image.rotate(-90, expand=True)
    rotatedImage.save(imageURL)
    rotatedImage.close()

def resizeImagesToFitWidth(folder, width=1080, height=1920):
    renameToJPEG(folder)
    images = [os.path.join(folder, img) for img in os.listdir(folder) if img.endswith(('jpeg'))]
    for img in images:
        # Open the original image
        original_image = Image.open(img)
        new_width, new_height = width, height
        # Create a new blank image with the desired dimensions and a black background
        new_image = Image.new('RGB', (new_width, new_height), (0, 0, 0))
        # Calculate the dimensions for the scaled image to fit the width
        scaled_width = new_width
        scaled_height = int(original_image.height * (new_width / original_image.width))

        # Calculate the position to center the scaled image vertically
        left = 0
        top = (new_height - scaled_height) // 2

        # Resize and paste the original image onto the new image
        resized_image = original_image.resize((scaled_width, scaled_height), resample=Image.LANCZOS)
        new_image.paste(resized_image, (left, top))

        # Save the resulting image with black borders
        new_image.save(img)

        # Close the images
        original_image.close()
        new_image.close()

def main():
    folder = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2025-07-14_21-29-24"
    renameToJPEG(folder)

if __name__ == "__main__":
    main()