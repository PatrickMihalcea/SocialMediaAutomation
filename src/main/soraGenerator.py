import os
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from undetected_chromedriver import Chrome, ChromeOptions
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
import time

# Quality can be 480 or 720.
class soraGenerator:
    def __init__(self, cookie_value : str, downloadDirectory: str):
        self.cookie_value = cookie_value
        self.downloadDirectory = downloadDirectory


    def createVideo(self, prompt, quality = 480, max_attempts=3):
        attempt = 1
    
        while attempt <= max_attempts:
            try:
                cookie = {"name": "__Secure-next-auth.session-token", "value": self.cookie_value}
                # Create new webscraper to run parallel.
                options = ChromeOptions()
                options.add_argument("--disable-blink-features=AutomationControlled")
                prefs = {'download.default_directory' : self.downloadDirectory,
                        'savefile.default_directory' : self.downloadDirectory,
                        'download.prompt_for_download': False,
                        'download.directory_upgrade': True,}
                options.add_experimental_option('prefs', prefs)
                options.headless = False
                driver = Chrome(options=options)
                # Go to Sora and supply login.
                driver.get("https://sora.chatgpt.com/explore")

                driver.add_cookie(cookie)

                driver.refresh()
                # Login Button click.
                WebDriverWait(driver,10).until(EC.visibility_of_element_located((By.XPATH,'/html/body/main/div/div[3]/div/div[3]/button[2]'))).click()
                
                # Set Parameters for generating video. Could not get it to click the popup so did it manually with move and offset.
                videoButton = WebDriverWait(driver,10).until(EC.presence_of_element_located((By.XPATH,'/html/body/main/div/div[2]/div[2]/div/div/div[2]/div[2]/div[1]/button[1]')))
                videoButton.click()
                actions = ActionChains(driver)
                actions.move_to_element(videoButton).perform()
                actions.move_by_offset(0,-40).click().perform() # Move about 40 up for bottom option, another 40 for each option above.
                # Change to 9 : 16 for vertical.
                aspectRatioButton = WebDriverWait(driver,10).until(EC.presence_of_element_located((By.XPATH,'/html/body/main/div/div[2]/div[2]/div/div/div[2]/div[2]/div[1]/button[2]')))
                aspectRatioButton.click()
                actions.move_to_element(aspectRatioButton).perform()
                actions.move_by_offset(0,-40).click().perform()
                # Change quality.
                if (quality == 720):
                    qualityButton = WebDriverWait(driver,10).until(EC.presence_of_element_located((By.XPATH,'/html/body/main/div/div[2]/div[2]/div/div/div[2]/div[2]/div[1]/button[3]')))
                    qualityButton.click()
                    actions.move_to_element(qualityButton).perform()
                    actions.move_by_offset(0,-80).click().perform() # -120 for 1080p but need premium.
                # Set to only generate one variation.
                videoVariationsButton = WebDriverWait(driver,10).until(EC.presence_of_element_located((By.XPATH,'/html/body/main/div/div[2]/div[2]/div/div/div[2]/div[2]/div[1]/button[5]')))
                videoVariationsButton.click()
                actions.move_to_element(videoVariationsButton).perform()
                actions.move_by_offset(0,-40).click().perform()
                # Give prompt and locate image once generated.
                searchbox = WebDriverWait(driver,5).until(EC.presence_of_element_located((By.XPATH,"/html/body/main/div/div[2]/div[2]/div/div/div[2]/div[1]/textarea")))
                searchbox.send_keys(prompt)
                print("generating image")
                searchbox.send_keys(Keys.ENTER)

                #Click new video.
                WebDriverWait(driver,2000).until(EC.presence_of_element_located((By.XPATH,"/html/body/section/ol/li/button[2]/div[1]"))).click()
                print(driver.current_url)

                # Download.
                downloadButton = WebDriverWait(driver,10).until(EC.presence_of_element_located((By.XPATH,'//*[@id="radix-:rj0:"]')))
                downloadButton.click()
                actions.move_to_element(downloadButton).perform()
                actions.move_by_offset(0,90).click().perform()
                
                WebDriverWait(driver,40).until(EC.presence_of_element_located((By.XPATH,'/html/body/div[4]/div[2]/button[2]'))).click()
                

                driver.quit()
                break
            except Exception as e:
                print(f"Attempt {attempt}: Failed")
                print(e)
                try:
                    driver.quit()
                except Exception as e:
                    print(e)
                attempt += 1

def main():
    cookie_value = os.getenv("SORA_COOKIE_VALUE")
    print(cookie_value)
    dir = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2024-04-22_13-31-27"
    driver = soraGenerator(cookie_value, dir)
    driver.createVideo("Super slow zoom toward realistic treehouse mansion in lush valley. From above. 4K hyper real. Waterfall in background, sunset lighting. Only a few clouds in sky. Accent lighting and luxury. Cave system located below.")
    print("done")

if __name__ == "__main__":
    main()