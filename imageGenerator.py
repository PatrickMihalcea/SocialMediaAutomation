import logging
import os
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from undetected_chromedriver import Chrome, ChromeOptions
from selenium.webdriver.common.keys import Keys
import time
import base64

class imageGenerator:
    def __init__(self, cookie_value: str, downloadDirectory: str):
        self.cookie_value = cookie_value
        self.downloadDirectory = downloadDirectory

    def create(self, prompt):
        try:
            cookie = {"name": "_U", "value": self.cookie_value}
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
            # Go to Bing Chat and supply login.
            driver.get("https://www.bing.com/chat")
            driver.add_cookie(cookie)
            #Give prompt and locate image once generated.
            searchbox = WebDriverWait(driver,5).until(EC.presence_of_element_located((By.CLASS_NAME,"cib-serp-main")))
            searchbox.send_keys(prompt)
            print("generating image")
            searchbox.send_keys(Keys.ENTER)
            shadowHost = searchbox.shadow_root
            shadowHost2 = WebDriverWait(shadowHost,15).until(EC.presence_of_element_located((By.ID,"cib-conversation-main"))).shadow_root
            shadowHost3 = WebDriverWait(shadowHost2,15).until(EC.presence_of_element_located((By.CSS_SELECTOR,"#cib-chat-main > cib-chat-turn:nth-child(4)"))).shadow_root
            shadowHost4 = WebDriverWait(shadowHost3,15).until(EC.presence_of_element_located((By.CLASS_NAME,"response-message-group"))).shadow_root
            shadowHost5 = WebDriverWait(shadowHost4,15).until(EC.presence_of_element_located((By.CSS_SELECTOR,"cib-message:nth-child(3)"))).shadow_root
            frame = WebDriverWait(shadowHost5,30).until(EC.presence_of_element_located((By.CSS_SELECTOR,".frame")))
            driver.switch_to.frame(frame)
            image = WebDriverWait(driver,60).until(EC.presence_of_element_located((By.CLASS_NAME,"mimg")))
            
            # Resize.
            image.click()
            WebDriverWait(driver,60).until(EC.presence_of_element_located((By.XPATH,"//*[@id='canvas-inlay-resize-fre-target']"))).click()
            WebDriverWait(driver,60).until(EC.presence_of_element_located((By.XPATH,"/html/body/div/div/div/div/div/div[5]/div/div/div/button[2]"))).click()
            WebDriverWait(driver,60).until(EC.presence_of_element_located((By.XPATH,"/html/body/div/div/div/div/div/div[5]/div/div/div/div/button[2]"))).click()
            # Download
            WebDriverWait(driver,60).until(EC.presence_of_element_located((By.XPATH,"//*[@id='canvas-inlay-header-bar-ellipsis-button']"))).click()
            WebDriverWait(driver,60).until(EC.presence_of_element_located((By.XPATH,"//*[@id='canvas-inlay-header-bar-download-button']"))).click()
            time.sleep(10) # Wait for file to download.
            print("downloaded")
            driver.quit()
        except:
            print("An error has occured when generating an image")
            return

def main():
    cookie = os.getenv("BING_COOKIE_VALUE")
    dir = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2024-04-22_13-31-27"
    driver = imageGenerator(cookie,dir)
    driver.create("Generate an image of a mountain climber climbing a mountain")
    
    # for filename in os.listdir(dir):
    #     if filename.endswith('.png'):
    #         new_filename = os.path.join(dir, filename[:-4] + '.jpg')
    #         os.rename(os.path.join(dir, filename), new_filename)
    print("done")

if __name__ == "__main__":
    main()